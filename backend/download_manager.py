"""
Download Manager
================
Production background download engine with queue, resume, retry,
progress tracking, checksum verification, and cancel support.

Supports:
  - HuggingFace direct HTTP downloads (with Range header resume)
  - Ollama model pulls (via /api/pull streaming)
  - Configurable concurrent download limit (semaphore-based)
  - Exponential backoff retry with interruptible sleep
  - SHA256 checksum verification after download
  - Thread-safe progress tracking
"""
from __future__ import annotations

import os
import json
import time
import uuid
import hashlib
import asyncio
import threading
from pathlib import Path
from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Callable

import requests


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

class DownloadState(str, Enum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    VERIFYING = "verifying"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class DownloadProgress:
    """Thread-safe progress snapshot for a single download."""
    task_id: str
    state: DownloadState = DownloadState.QUEUED
    downloaded_bytes: int = 0
    total_bytes: int = 0
    speed_bps: float = 0.0
    eta_seconds: float = 0.0
    error: Optional[str] = None
    attempt: int = 0
    max_retries: int = 3
    filename: str = ""
    model_id: str = ""
    source: str = ""  # "huggingface" | "ollama"

    @property
    def progress_percent(self) -> float:
        if self.total_bytes <= 0:
            return 0.0
        return min(100.0, (self.downloaded_bytes / self.total_bytes) * 100)

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "state": self.state.value,
            "progress_percent": round(self.progress_percent, 2),
            "downloaded_bytes": self.downloaded_bytes,
            "total_bytes": self.total_bytes,
            "speed_bps": round(self.speed_bps, 2),
            "eta_seconds": round(self.eta_seconds, 1),
            "error": self.error,
            "attempt": self.attempt,
            "max_retries": self.max_retries,
            "filename": self.filename,
            "model_id": self.model_id,
            "source": self.source,
        }


# ---------------------------------------------------------------------------
# Download Manager
# ---------------------------------------------------------------------------

class DownloadManager:
    """
    Async-friendly download manager.

    * Concurrent limit via ``asyncio.Semaphore``
    * Downloads run in a ``ThreadPoolExecutor`` so they never block the
      event loop.
    * Progress is stored in a thread-safe dict; the FastAPI handler can
      poll it from any coroutine.
    """

    def __init__(
        self,
        max_concurrent: int = 2,
        download_timeout: int = 7200,
        chunk_size: int = 32_768,
        max_retries: int = 3,
    ):
        self.max_concurrent = max_concurrent
        self.download_timeout = download_timeout
        self.chunk_size = chunk_size
        self.max_retries = max_retries

        # Thread-safe state
        self._progress: Dict[str, DownloadProgress] = {}
        self._cancel_flags: Dict[str, threading.Event] = {}
        self._lock = threading.Lock()

        # Lazy-initialised in the running event loop
        self._semaphore: Optional[asyncio.Semaphore] = None

        # Optional per-task callbacks fired on completion
        self._on_complete: Dict[str, Callable] = {}

    # -- helpers ------------------------------------------------------------

    def _sem(self) -> asyncio.Semaphore:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self.max_concurrent)
        return self._semaphore

    @staticmethod
    def _interruptible_sleep(seconds: float, cancel: threading.Event):
        """Sleep that can be interrupted by a cancel event."""
        for _ in range(int(seconds)):
            if cancel.is_set():
                return
            time.sleep(1)
        rem = seconds - int(seconds)
        if rem > 0 and not cancel.is_set():
            time.sleep(rem)

    @staticmethod
    def _verify_sha256(path: str, expected: str) -> bool:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            while True:
                block = f.read(65_536)
                if not block:
                    break
                h.update(block)
        actual = h.hexdigest()
        ok = actual.lower() == expected.lower()
        if not ok:
            print(f"[download_manager] SHA256 mismatch: expected={expected} actual={actual}")
        return ok

    @staticmethod
    def _format_bytes(n: int) -> str:
        for unit in ("B", "KB", "MB", "GB", "TB"):
            if abs(n) < 1024:
                return f"{n:.1f} {unit}"
            n /= 1024  # type: ignore[assignment]
        return f"{n:.1f} PB"

    # -- public API ---------------------------------------------------------

    async def start_http_download(
        self,
        url: str,
        dest_path: str,
        *,
        model_id: str,
        filename: str,
        source: str = "huggingface",
        expected_size: int = 0,
        expected_hash: Optional[str] = None,
        on_complete: Optional[Callable] = None,
    ) -> str:
        """Enqueue an HTTP download.  Returns *task_id*."""
        task_id = uuid.uuid4().hex[:12]

        progress = DownloadProgress(
            task_id=task_id,
            state=DownloadState.QUEUED,
            total_bytes=expected_size,
            filename=filename,
            model_id=model_id,
            source=source,
            max_retries=self.max_retries,
        )
        cancel = threading.Event()

        with self._lock:
            self._progress[task_id] = progress
            self._cancel_flags[task_id] = cancel
            if on_complete:
                self._on_complete[task_id] = on_complete

        asyncio.create_task(
            self._run_http(task_id, url, dest_path, expected_hash, cancel)
        )
        return task_id

    async def start_ollama_pull(
        self,
        model_name: str,
        *,
        ollama_url: str = "http://localhost:11434",
        on_complete: Optional[Callable] = None,
    ) -> str:
        """Enqueue an Ollama pull.  Returns *task_id*."""
        task_id = uuid.uuid4().hex[:12]

        progress = DownloadProgress(
            task_id=task_id,
            state=DownloadState.QUEUED,
            filename=model_name,
            model_id=model_name,
            source="ollama",
            max_retries=self.max_retries,
        )
        cancel = threading.Event()

        with self._lock:
            self._progress[task_id] = progress
            self._cancel_flags[task_id] = cancel
            if on_complete:
                self._on_complete[task_id] = on_complete

        asyncio.create_task(
            self._run_ollama(task_id, model_name, ollama_url, cancel)
        )
        return task_id

    def get_progress(self, task_id: str) -> Optional[dict]:
        with self._lock:
            p = self._progress.get(task_id)
            return p.to_dict() if p else None

    def get_all_progress(self) -> List[dict]:
        with self._lock:
            return [p.to_dict() for p in self._progress.values()]

    def get_active_downloads(self) -> List[dict]:
        with self._lock:
            return [
                p.to_dict()
                for p in self._progress.values()
                if p.state in (DownloadState.QUEUED, DownloadState.DOWNLOADING, DownloadState.VERIFYING)
            ]

    def cancel(self, task_id: str) -> bool:
        with self._lock:
            flag = self._cancel_flags.get(task_id)
            if flag:
                flag.set()
                p = self._progress.get(task_id)
                if p and p.state in (DownloadState.QUEUED, DownloadState.DOWNLOADING):
                    p.state = DownloadState.CANCELLED
                    return True
        return False

    def cleanup(self, task_id: str):
        with self._lock:
            self._progress.pop(task_id, None)
            self._cancel_flags.pop(task_id, None)
            self._on_complete.pop(task_id, None)

    # -- internal: HTTP download -------------------------------------------

    async def _run_http(
        self,
        task_id: str,
        url: str,
        dest_path: str,
        expected_hash: Optional[str],
        cancel: threading.Event,
    ):
        await self._sem().acquire()
        try:
            p = self._progress.get(task_id)
            if not p or cancel.is_set():
                return
            p.state = DownloadState.DOWNLOADING
            await asyncio.to_thread(
                self._http_worker, task_id, url, dest_path, expected_hash, cancel
            )
            await self._fire_callback(task_id, dest_path)
        finally:
            self._sem().release()

    def _http_worker(
        self,
        task_id: str,
        url: str,
        dest_path: str,
        expected_hash: Optional[str],
        cancel: threading.Event,
    ):
        """Blocking HTTP download with resume & retry.  Runs in thread."""
        p = self._progress.get(task_id)
        if not p:
            return

        os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
        part = dest_path + ".part"

        for attempt in range(self.max_retries + 1):
            if cancel.is_set():
                p.state = DownloadState.CANCELLED
                return
            try:
                p.attempt = attempt + 1
                p.error = None

                # Resume
                downloaded = os.path.getsize(part) if os.path.exists(part) else 0
                headers = {"User-Agent": "Minette-PDF-ChatBot/1.0"}
                if downloaded > 0:
                    headers["Range"] = f"bytes={downloaded}-"

                resp = requests.get(
                    url,
                    headers=headers,
                    stream=True,
                    timeout=(30, self.download_timeout),
                    allow_redirects=True,
                )

                if resp.status_code == 416:
                    # Range not satisfiable → already complete
                    if downloaded > 0:
                        os.replace(part, dest_path)
                        p.downloaded_bytes = downloaded
                        p.total_bytes = downloaded
                        p.state = DownloadState.COMPLETED
                        return

                resp.raise_for_status()

                # Determine mode & total
                if resp.status_code == 206:
                    cr = resp.headers.get("Content-Range", "")
                    if "/" in cr:
                        total = int(cr.rsplit("/", 1)[-1])
                    else:
                        total = downloaded + int(resp.headers.get("Content-Length", 0))
                    mode = "ab"
                else:
                    downloaded = 0
                    total = int(resp.headers.get("Content-Length", 0))
                    mode = "wb"

                p.total_bytes = total
                p.downloaded_bytes = downloaded

                speed_bytes = 0
                speed_t = time.time()

                with open(part, mode) as f:
                    for chunk in resp.iter_content(chunk_size=self.chunk_size):
                        if cancel.is_set():
                            p.state = DownloadState.CANCELLED
                            return
                        if chunk:
                            f.write(chunk)
                            n = len(chunk)
                            downloaded += n
                            speed_bytes += n
                            p.downloaded_bytes = downloaded

                            now = time.time()
                            dt = now - speed_t
                            if dt >= 1.5:
                                p.speed_bps = speed_bytes / dt
                                remaining = max(0, total - downloaded)
                                p.eta_seconds = remaining / p.speed_bps if p.speed_bps > 0 else 0
                                speed_bytes = 0
                                speed_t = now

                # Checksum
                if expected_hash:
                    p.state = DownloadState.VERIFYING
                    if not self._verify_sha256(part, expected_hash):
                        os.remove(part)
                        raise ValueError(f"SHA256 checksum mismatch for {p.filename}")

                # Finalise
                os.replace(part, dest_path)
                sz = os.path.getsize(dest_path)
                p.downloaded_bytes = sz
                p.total_bytes = sz
                p.state = DownloadState.COMPLETED
                p.speed_bps = 0
                p.eta_seconds = 0
                print(f"[download_manager] HTTP download complete: {p.filename} ({self._format_bytes(sz)})")
                return

            except (requests.ConnectionError, requests.Timeout, requests.ChunkedEncodingError) as e:
                self._handle_retry(p, attempt, e, cancel)
                if cancel.is_set() or attempt >= self.max_retries:
                    return
            except Exception as e:
                self._handle_retry(p, attempt, e, cancel)
                if cancel.is_set() or attempt >= self.max_retries:
                    return

    # -- internal: Ollama pull --------------------------------------------

    async def _run_ollama(
        self,
        task_id: str,
        model_name: str,
        ollama_url: str,
        cancel: threading.Event,
    ):
        await self._sem().acquire()
        try:
            p = self._progress.get(task_id)
            if not p or cancel.is_set():
                return
            p.state = DownloadState.DOWNLOADING
            await asyncio.to_thread(
                self._ollama_worker, task_id, model_name, ollama_url, cancel
            )
            await self._fire_callback(task_id, None)
        finally:
            self._sem().release()

    def _ollama_worker(
        self,
        task_id: str,
        model_name: str,
        ollama_url: str,
        cancel: threading.Event,
    ):
        """Blocking Ollama pull with streaming progress.  Runs in thread."""
        p = self._progress.get(task_id)
        if not p:
            return

        for attempt in range(self.max_retries + 1):
            if cancel.is_set():
                p.state = DownloadState.CANCELLED
                return
            try:
                p.attempt = attempt + 1
                p.error = None

                resp = requests.post(
                    f"{ollama_url}/api/pull",
                    json={"name": model_name, "stream": True},
                    stream=True,
                    timeout=(30, self.download_timeout),
                )
                resp.raise_for_status()

                for line in resp.iter_lines():
                    if cancel.is_set():
                        p.state = DownloadState.CANCELLED
                        return
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if "error" in data:
                        raise RuntimeError(data["error"])

                    total = data.get("total", 0)
                    completed = data.get("completed", 0)
                    if total > 0:
                        p.total_bytes = total
                        p.downloaded_bytes = completed

                    if data.get("status") == "success":
                        p.state = DownloadState.COMPLETED
                        p.speed_bps = 0
                        p.eta_seconds = 0
                        print(f"[download_manager] Ollama pull complete: {model_name}")
                        return

                # Stream ended without "success" — verify with tags
                try:
                    tags = requests.get(f"{ollama_url}/api/tags", timeout=5).json()
                    names = [m.get("name", "") for m in tags.get("models", [])]
                    base = model_name.split(":")[0]
                    if model_name in names or any(n.startswith(base) for n in names):
                        p.state = DownloadState.COMPLETED
                        return
                except Exception:
                    pass

                raise RuntimeError(f"Ollama pull stream ended without success for {model_name}")

            except Exception as e:
                self._handle_retry(p, attempt, e, cancel)
                if cancel.is_set() or attempt >= self.max_retries:
                    return

    # -- shared helpers -----------------------------------------------------

    def _handle_retry(
        self,
        p: DownloadProgress,
        attempt: int,
        error: Exception,
        cancel: threading.Event,
    ):
        if attempt < self.max_retries:
            wait = min(2 ** attempt * 5, 120)
            p.error = f"Retry {attempt + 1}/{self.max_retries}: {error}"
            print(f"[download_manager] {p.error} — waiting {wait}s")
            self._interruptible_sleep(wait, cancel)
        else:
            p.state = DownloadState.FAILED
            p.error = str(error)
            print(f"[download_manager] FAILED after {self.max_retries} retries: {error}")

    async def _fire_callback(self, task_id: str, dest_path: Optional[str]):
        cb = self._on_complete.get(task_id)
        p = self._progress.get(task_id)
        if cb and p and p.state == DownloadState.COMPLETED:
            try:
                result = cb(task_id, dest_path, p.model_id)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                print(f"[download_manager] completion callback error: {e}")
