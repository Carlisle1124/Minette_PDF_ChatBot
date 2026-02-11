"""
Model Manager  (v2)
====================
Central orchestrator for model lifecycle:

    Frontend → API Endpoints → **ModelManager** → DownloadManager (background)
                                                → ModelRegistry   (discovery)
                                                → Local Storage   (./models/)

Public surface used by ``main.py``:
    manager.get_online_models(query, source, limit)
    manager.get_local_models()
    manager.start_download(source, model_name, repo_id, filename)
    manager.get_progress(task_id)
    manager.cancel_download(task_id)
    manager.delete_model(model_id)
    manager.get_queue()

Backward-compat aliases (used by existing endpoints):
    ModelDownloadManager = ModelManager
    DownloadStatus       = download_manager.DownloadState
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Dict, List, Optional

from download_manager import DownloadManager, DownloadState
from model_registry import (
    ModelRegistry,
    OnlineModelInfo,
    LocalModelInfo,
    _format_bytes,
)

# Backward-compat alias so existing ``from model_manager import DownloadStatus``
# keeps working (maps to the new enum).
DownloadStatus = DownloadState


class ModelManager:
    """
    Unified model manager.

    * Discovery:  curated catalog + HuggingFace search + Ollama tags
    * Downloads:  async background via ``DownloadManager``
    * Storage:    ``./models/{model_id}/`` for HF files; Ollama-managed for pulls
    * Registry:   ``./models/registry.json`` tracks HF-downloaded models
    """

    def __init__(
        self,
        models_dir: str = "models",
        ollama_url: str = "http://localhost:11434",
        max_concurrent_downloads: int = 2,
    ):
        self.models_dir = Path(models_dir)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.ollama_url = ollama_url

        self.registry = ModelRegistry(ollama_url)
        self.downloads = DownloadManager(max_concurrent=max_concurrent_downloads)

        # Persistent local registry for HF downloads
        self._reg_path = self.models_dir / "registry.json"
        self._local_reg: Dict[str, dict] = self._load_registry()

    # ------------------------------------------------------------------
    # Local registry persistence (HuggingFace models only)
    # ------------------------------------------------------------------

    def _load_registry(self) -> Dict[str, dict]:
        if self._reg_path.exists():
            try:
                with open(self._reg_path, "r") as f:
                    return json.load(f)
            except Exception as e:
                print(f"[model_manager] registry load error: {e}")
        return {}

    def _save_registry(self):
        try:
            with open(self._reg_path, "w") as f:
                json.dump(self._local_reg, f, indent=2)
        except Exception as e:
            print(f"[model_manager] registry save error: {e}")

    def _register_hf_model(
        self, task_id: Optional[str], dest_path: Optional[str], model_id: str
    ):
        """Callback fired by DownloadManager when an HF download completes."""
        size = os.path.getsize(dest_path) if dest_path and os.path.exists(dest_path) else 0
        self._local_reg[model_id] = {
            "model_id": model_id,
            "local_path": dest_path,
            "size_bytes": size,
            "size_label": _format_bytes(size),
            "source": "huggingface",
        }
        self._save_registry()
        print(f"[model_manager] registered HF model: {model_id}")

    # ------------------------------------------------------------------
    # Online models  (GET /models/online)
    # ------------------------------------------------------------------

    async def get_online_models(
        self,
        query: Optional[str] = None,
        source: Optional[str] = None,
        limit: int = 20,
    ) -> List[dict]:
        """
        Return models available for download.

        * No query → curated catalog (with ``installed`` flag resolved).
        * ``source=huggingface`` + query → HuggingFace search.
        * ``source=ollama`` (no query) → curated Ollama list.
        """
        # Resolve which models are already local
        local_ids = set()
        try:
            ollama_local = await self.registry.list_ollama_local()
            for m in ollama_local:
                local_ids.add(m.id)
                # Also add the base name (without tag)
                base = m.id.split(":")[0]
                local_ids.add(base)
        except Exception:
            pass
        for mid in self._local_reg:
            local_ids.add(mid)

        results: List[OnlineModelInfo] = []

        if query and (source is None or source == "huggingface"):
            results = await self.registry.search_huggingface(query, limit)
        elif source == "huggingface" and not query:
            results = await self.registry.search_huggingface("gguf", limit)
        else:
            results = self.registry.get_curated()

        # Mark installed flag
        for m in results:
            if m.id in local_ids:
                m.installed = True

        return [m.to_dict() for m in results]

    # ------------------------------------------------------------------
    # Local models  (GET /models/local)
    # ------------------------------------------------------------------

    async def get_local_models(self) -> List[dict]:
        """
        Combine Ollama-pulled models + HF-downloaded models into one list.
        """
        models: List[dict] = []

        # 1) Ollama local
        try:
            ollama_models = await self.registry.list_ollama_local()
            for m in ollama_models:
                models.append(m.to_dict())
        except Exception as e:
            print(f"[model_manager] ollama local list error: {e}")

        # 2) HF downloaded (from registry.json)
        for mid, info in self._local_reg.items():
            lp = info.get("local_path")
            exists = lp and os.path.exists(lp)
            models.append({
                "id": mid,
                "name": mid,
                "source": "huggingface",
                "size_bytes": info.get("size_bytes", 0),
                "size_label": info.get("size_label", ""),
                "local_path": lp if exists else None,
                "family": "",
                "quantization": "",
                "tags": ["huggingface"],
                "available": exists,
            })

        return models

    # ------------------------------------------------------------------
    # Start download  (POST /models/download)
    # ------------------------------------------------------------------

    async def start_download(
        self,
        source: str = "ollama",
        model_name: Optional[str] = None,
        repo_id: Optional[str] = None,
        filename: Optional[str] = None,
        model_id: Optional[str] = None,
    ) -> dict:
        """
        Start a background download.  Returns ``{task_id, model_id, source}``.

        For **Ollama**: supply ``model_name`` (e.g. ``"llama3.2:1b"``).
        For **HuggingFace**: supply ``repo_id`` + ``filename``.
        """
        if source == "ollama":
            if not model_name:
                raise ValueError("model_name is required for Ollama downloads")
            task_id = await self.downloads.start_ollama_pull(
                model_name,
                ollama_url=self.ollama_url,
            )
            return {"task_id": task_id, "model_id": model_name, "source": "ollama"}

        elif source == "huggingface":
            if not repo_id or not filename:
                raise ValueError("repo_id and filename are required for HuggingFace downloads")

            mid = model_id or f"{repo_id}__{filename}".replace("/", "_")
            dest_dir = self.models_dir / mid.replace("/", "_")
            dest_path = str(dest_dir / filename)

            url = self.registry.get_hf_download_url(repo_id, filename)

            # Try to get file sha256 from repo metadata
            sha256 = None
            try:
                files = await self.registry.get_hf_model_files(repo_id)
                for f in files:
                    if f.get("filename") == filename:
                        sha256 = f.get("sha256")
                        break
            except Exception:
                pass

            task_id = await self.downloads.start_http_download(
                url=url,
                dest_path=dest_path,
                model_id=mid,
                filename=filename,
                source="huggingface",
                expected_hash=sha256,
                on_complete=self._register_hf_model,
            )
            return {"task_id": task_id, "model_id": mid, "source": "huggingface"}

        else:
            raise ValueError(f"Unknown source: {source}")

    # ------------------------------------------------------------------
    # Progress / Queue  (GET /models/progress/:id , GET /models/queue)
    # ------------------------------------------------------------------

    def get_progress(self, task_id: str) -> Optional[dict]:
        return self.downloads.get_progress(task_id)

    def get_queue(self) -> List[dict]:
        return self.downloads.get_all_progress()

    def get_active_downloads(self) -> List[dict]:
        return self.downloads.get_active_downloads()

    # ------------------------------------------------------------------
    # Cancel  (POST /models/cancel/:id)
    # ------------------------------------------------------------------

    def cancel_download(self, task_id: str) -> bool:
        return self.downloads.cancel(task_id)

    # ------------------------------------------------------------------
    # Delete local model
    # ------------------------------------------------------------------

    async def delete_model(self, model_id: str) -> bool:
        """Delete a model from local storage."""
        deleted = False

        # 1) HF registry
        if model_id in self._local_reg:
            info = self._local_reg[model_id]
            lp = info.get("local_path")
            if lp:
                model_dir = Path(lp).parent
                if model_dir.exists() and model_dir != self.models_dir:
                    shutil.rmtree(model_dir, ignore_errors=True)
            del self._local_reg[model_id]
            self._save_registry()
            deleted = True
            print(f"[model_manager] deleted HF model: {model_id}")

        # 2) Ollama
        try:
            import requests
            resp = requests.delete(
                f"{self.ollama_url}/api/delete",
                json={"name": model_id},
                timeout=15,
            )
            if resp.status_code == 200:
                deleted = True
                print(f"[model_manager] deleted Ollama model: {model_id}")
        except Exception:
            pass

        return deleted

    # ------------------------------------------------------------------
    # HuggingFace search & repo files  (backward-compat helpers)
    # ------------------------------------------------------------------

    async def search_models(
        self,
        query: str,
        limit: int = 10,
        task: Optional[str] = None,
    ) -> List[dict]:
        """Backward-compat: search HuggingFace Hub."""
        models = await self.registry.search_huggingface(query, limit, task)
        return [m.to_dict() for m in models]

    async def list_repo_files_api(self, repo_id: str) -> List[str]:
        """Backward-compat: list files in a HF repo."""
        files_info = await self.registry.get_hf_model_files(repo_id)
        return [f["filename"] for f in files_info]

    async def get_repo_files_detailed(self, repo_id: str) -> List[dict]:
        """List files in a HF repo with size + URL + sha256."""
        return await self.registry.get_hf_model_files(repo_id)

    # ------------------------------------------------------------------
    # Legacy accessors (keep old endpoints working while we migrate)
    # ------------------------------------------------------------------

    def list_available_models(self):
        """Legacy: return HF registry entries as list of dicts."""
        return [
            type("M", (), {
                "model_id": mid,
                "repo_id": info.get("model_id", mid),
                "filename": "",
                "local_path": info.get("local_path"),
                "size_bytes": info.get("size_bytes"),
                "status": DownloadState.COMPLETED,
                "progress": 100.0,
            })
            for mid, info in self._local_reg.items()
        ]

    def get_model_info(self, model_id: str):
        info = self._local_reg.get(model_id)
        if not info:
            return None
        return type("M", (), {
            "model_id": model_id,
            "repo_id": info.get("model_id", model_id),
            "filename": "",
            "local_path": info.get("local_path"),
            "size_bytes": info.get("size_bytes"),
            "status": DownloadState.COMPLETED,
            "progress": 100.0,
            "error": None,
        })

    def get_download_status(self, model_id: str):
        # Check active downloads first
        for tid, p_dict in [(k, self.downloads.get_progress(k)) for k in list(self.downloads._progress.keys())]:
            if p_dict and p_dict.get("model_id") == model_id:
                return type("S", (), {
                    "model_id": model_id,
                    "progress": p_dict["progress_percent"],
                    "downloaded_bytes": p_dict["downloaded_bytes"],
                    "total_bytes": p_dict["total_bytes"],
                    "status": DownloadState(p_dict["state"]),
                    "error": p_dict.get("error"),
                })
        info = self._local_reg.get(model_id)
        if info:
            return type("S", (), {
                "model_id": model_id,
                "progress": 100.0,
                "downloaded_bytes": info.get("size_bytes", 0),
                "total_bytes": info.get("size_bytes", 0),
                "status": DownloadState.COMPLETED,
                "error": None,
            })
        return None


# Backward-compat alias
ModelDownloadManager = ModelManager
