"""
Model Registry
==============
Discovers models from multiple sources:
  - Curated catalog of recommended Ollama-compatible models
  - HuggingFace Hub search API
  - Local Ollama instance (already-pulled models)

The registry is read-only; it never writes to disk. Local model
persistence is handled by ``ModelManager``.
"""
from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional

import requests

try:
    from huggingface_hub import HfApi, hf_hub_url
    HF_AVAILABLE = True
except ImportError:
    HF_AVAILABLE = False


# ---------------------------------------------------------------------------
# Curated catalog — keep in sync with frontend AVAILABLE_MODELS
# ---------------------------------------------------------------------------

CURATED_MODELS: List[Dict] = [
    {
        "id": "llama3.2:1b",
        "name": "Llama 3.2 1B",
        "source": "ollama",
        "size_label": "1.3 GB",
        "description": "Meta's smallest Llama — very fast",
        "tags": ["text-generation", "chat", "small"],
    },
    {
        "id": "llama3.2:3b",
        "name": "Llama 3.2 3B",
        "source": "ollama",
        "size_label": "2.0 GB",
        "description": "Great balance of speed and quality",
        "tags": ["text-generation", "chat"],
    },
    {
        "id": "phi3:mini",
        "name": "Phi-3 Mini",
        "source": "ollama",
        "size_label": "2.2 GB",
        "description": "Microsoft's efficient small model",
        "tags": ["text-generation", "chat", "small"],
    },
    {
        "id": "gemma2:2b",
        "name": "Gemma 2 2B",
        "source": "ollama",
        "size_label": "1.6 GB",
        "description": "Google's lightweight model",
        "tags": ["text-generation", "chat", "small"],
    },
    {
        "id": "qwen2.5:1.5b",
        "name": "Qwen 2.5 1.5B",
        "source": "ollama",
        "size_label": "1.0 GB",
        "description": "Alibaba's compact model",
        "tags": ["text-generation", "chat", "small"],
    },
    {
        "id": "qwen2.5:3b",
        "name": "Qwen 2.5 3B",
        "source": "ollama",
        "size_label": "1.9 GB",
        "description": "Slightly larger Qwen variant",
        "tags": ["text-generation", "chat"],
    },
    {
        "id": "tinyllama:1.1b",
        "name": "TinyLlama 1.1B",
        "source": "ollama",
        "size_label": "637 MB",
        "description": "Ultra-compact, very fast",
        "tags": ["text-generation", "chat", "tiny"],
    },
    {
        "id": "stablelm2:1.6b",
        "name": "StableLM 2 1.6B",
        "source": "ollama",
        "size_label": "1.0 GB",
        "description": "Stability AI's small model",
        "tags": ["text-generation", "chat", "small"],
    },
    {
        "id": "deepseek-r1:1.5b",
        "name": "DeepSeek R1 1.5B",
        "source": "ollama",
        "size_label": "1.1 GB",
        "description": "DeepSeek's reasoning model",
        "tags": ["text-generation", "reasoning", "small"],
    },
    {
        "id": "smollm:1.7b",
        "name": "SmolLM 1.7B",
        "source": "ollama",
        "size_label": "1.0 GB",
        "description": "Hugging Face's tiny model",
        "tags": ["text-generation", "chat", "small"],
    },
    {
        "id": "nomic-embed-text",
        "name": "Nomic Embed Text",
        "source": "ollama",
        "size_label": "274 MB",
        "description": "High-quality text embeddings",
        "tags": ["embeddings"],
    },
    {
        "id": "mistral:7b",
        "name": "Mistral 7B",
        "source": "ollama",
        "size_label": "4.1 GB",
        "description": "Mistral AI's flagship open model",
        "tags": ["text-generation", "chat"],
    },
    {
        "id": "llama3.1:8b",
        "name": "Llama 3.1 8B",
        "source": "ollama",
        "size_label": "4.7 GB",
        "description": "Meta's strong 8B model",
        "tags": ["text-generation", "chat"],
    },
]


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class OnlineModelInfo:
    """Describes a model available for download."""
    id: str
    name: str
    source: str                          # "ollama" | "huggingface"
    size_label: str
    description: str
    tags: List[str]
    downloads: int = 0
    likes: int = 0
    repo_id: Optional[str] = None       # HuggingFace repo ID
    filename: Optional[str] = None      # specific file to download
    download_url: Optional[str] = None
    sha256: Optional[str] = None
    installed: bool = False              # True if already local

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class LocalModelInfo:
    """Describes a locally installed model."""
    id: str
    name: str
    source: str
    size_bytes: int = 0
    size_label: str = ""
    local_path: Optional[str] = None
    family: str = ""
    quantization: str = ""
    tags: List[str] = None  # type: ignore[assignment]

    def __post_init__(self):
        if self.tags is None:
            self.tags = []
        if not self.size_label and self.size_bytes > 0:
            self.size_label = _format_bytes(self.size_bytes)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024  # type: ignore[assignment]
    return f"{n:.1f} PB"


# ---------------------------------------------------------------------------
# Registry class
# ---------------------------------------------------------------------------

class ModelRegistry:
    """
    Read-only discovery layer.

    * ``get_curated()`` → hardcoded recommended models
    * ``search_huggingface()`` → HuggingFace Hub API
    * ``get_hf_model_files()`` → files in a HF repo
    * ``get_hf_download_url()`` → direct CDN link
    * ``list_ollama_local()`` → models already pulled in Ollama
    """

    def __init__(self, ollama_base_url: str = "http://localhost:11434"):
        self.ollama_url = ollama_base_url
        self.hf_api = HfApi() if HF_AVAILABLE else None

    # -- curated -----------------------------------------------------------

    def get_curated(self) -> List[OnlineModelInfo]:
        return [OnlineModelInfo(**m) for m in CURATED_MODELS]

    # -- HuggingFace -------------------------------------------------------

    async def search_huggingface(
        self,
        query: str,
        limit: int = 20,
        task: Optional[str] = None,
    ) -> List[OnlineModelInfo]:
        if not HF_AVAILABLE or self.hf_api is None:
            return []
        try:
            models = await asyncio.to_thread(
                lambda: list(self.hf_api.list_models(
                    search=query,
                    limit=limit,
                    task=task,
                    sort="downloads",
                    direction=-1,
                ))
            )
            results: List[OnlineModelInfo] = []
            for m in models:
                results.append(OnlineModelInfo(
                    id=m.modelId,
                    name=m.modelId.split("/")[-1] if "/" in m.modelId else m.modelId,
                    source="huggingface",
                    size_label="",
                    description=(m.pipeline_tag or ""),
                    tags=m.tags or [],
                    downloads=m.downloads or 0,
                    likes=m.likes or 0,
                    repo_id=m.modelId,
                ))
            return results
        except Exception as e:
            print(f"[model_registry] HuggingFace search error: {e}")
            return []

    async def get_hf_model_files(self, repo_id: str) -> List[dict]:
        """Return files in a HF repo with size + download URL."""
        if not HF_AVAILABLE or self.hf_api is None:
            return []
        try:
            items = await asyncio.to_thread(
                lambda: list(self.hf_api.list_repo_tree(repo_id=repo_id))
            )
            results = []
            for f in items:
                if not hasattr(f, "rfilename"):
                    continue
                entry: Dict = {
                    "filename": f.rfilename,
                    "size": getattr(f, "size", None),
                    "size_label": _format_bytes(f.size) if getattr(f, "size", None) else "",
                    "download_url": hf_hub_url(repo_id, f.rfilename),
                }
                # Include LFS sha256 if present
                lfs = getattr(f, "lfs", None)
                if lfs and hasattr(lfs, "sha256"):
                    entry["sha256"] = lfs.sha256
                results.append(entry)
            return results
        except Exception as e:
            print(f"[model_registry] list repo files error: {e}")
            return []

    def get_hf_download_url(self, repo_id: str, filename: str) -> str:
        """Get direct CDN download URL for a HuggingFace file."""
        if HF_AVAILABLE:
            try:
                return hf_hub_url(repo_id, filename)
            except Exception:
                pass
        return f"https://huggingface.co/{repo_id}/resolve/main/{filename}"

    # -- Ollama local models -----------------------------------------------

    async def list_ollama_local(self) -> List[LocalModelInfo]:
        """Return models already pulled in the local Ollama instance."""
        try:
            resp = await asyncio.to_thread(
                lambda: requests.get(f"{self.ollama_url}/api/tags", timeout=5)
            )
            if resp.status_code != 200:
                return []
            models = resp.json().get("models", [])
            results: List[LocalModelInfo] = []
            for m in models:
                details = m.get("details", {})
                results.append(LocalModelInfo(
                    id=m.get("name", ""),
                    name=m.get("name", ""),
                    source="ollama",
                    size_bytes=m.get("size", 0),
                    family=details.get("family", ""),
                    quantization=details.get("quantization_level", ""),
                    tags=["ollama", details.get("family", "")],
                ))
            return results
        except Exception as e:
            print(f"[model_registry] Ollama list error: {e}")
            return []

    async def is_ollama_available(self) -> bool:
        """Check if the Ollama server is reachable."""
        try:
            resp = await asyncio.to_thread(
                lambda: requests.get(self.ollama_url, timeout=3)
            )
            return resp.status_code == 200
        except Exception:
            return False
