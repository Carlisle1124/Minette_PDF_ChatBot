"""
Model Manager Service
Handles downloading and managing AI models from HuggingFace Hub
"""
from __future__ import annotations

import os
import json
import asyncio
from pathlib import Path
from typing import Dict, List, Optional, Callable
from dataclasses import dataclass, asdict
from enum import Enum
import shutil

try:
    from huggingface_hub import hf_hub_download, list_repo_files, HfApi
    from huggingface_hub.utils import HfHubHTTPError
    HF_HUB_AVAILABLE = True
except ImportError:
    HF_HUB_AVAILABLE = False


class DownloadStatus(str, Enum):
    PENDING = "pending"
    DOWNLOADING = "downloading"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class ModelInfo:
    """Information about a model"""
    model_id: str
    repo_id: str
    filename: str
    local_path: Optional[str] = None
    size_bytes: Optional[int] = None
    status: DownloadStatus = DownloadStatus.PENDING
    progress: float = 0.0
    error: Optional[str] = None


@dataclass
class DownloadProgress:
    """Progress information for a download"""
    model_id: str
    progress: float
    downloaded_bytes: int
    total_bytes: int
    status: DownloadStatus
    error: Optional[str] = None


class ModelDownloadManager:
    """Manages model downloads from HuggingFace Hub"""
    
    def __init__(self, models_dir: str = "models"):
        """
        Initialize the model download manager
        
        Args:
            models_dir: Directory to store downloaded models
        """
        if not HF_HUB_AVAILABLE:
            raise RuntimeError(
                "huggingface_hub is required. Install with: pip install huggingface-hub"
            )
        
        self.models_dir = Path(models_dir)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        
        # Track active downloads
        self.active_downloads: Dict[str, ModelInfo] = {}
        self.download_callbacks: Dict[str, List[Callable]] = {}
        
        # Initialize HuggingFace API
        self.hf_api = HfApi()
        
        # Load existing models registry
        self.registry_file = self.models_dir / "registry.json"
        self.registry: Dict[str, ModelInfo] = self._load_registry()
    
    def _load_registry(self) -> Dict[str, ModelInfo]:
        """Load the models registry from disk"""
        if self.registry_file.exists():
            try:
                with open(self.registry_file, 'r') as f:
                    data = json.load(f)
                    return {
                        k: ModelInfo(**v) for k, v in data.items()
                    }
            except Exception as e:
                print(f"Error loading registry: {e}")
        return {}
    
    def _save_registry(self):
        """Save the models registry to disk"""
        try:
            with open(self.registry_file, 'w') as f:
                data = {k: asdict(v) for k, v in self.registry.items()}
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Error saving registry: {e}")
    
    def list_available_models(self) -> List[ModelInfo]:
        """List all models available in the local registry"""
        return list(self.registry.values())
    
    def get_model_info(self, model_id: str) -> Optional[ModelInfo]:
        """Get information about a specific model"""
        return self.registry.get(model_id)
    
    def is_model_downloaded(self, model_id: str) -> bool:
        """Check if a model is already downloaded"""
        model_info = self.registry.get(model_id)
        if not model_info:
            return False
        
        if model_info.local_path and os.path.exists(model_info.local_path):
            return model_info.status == DownloadStatus.COMPLETED
        return False
    
    async def download_model(
        self,
        repo_id: str,
        filename: str,
        model_id: Optional[str] = None,
        progress_callback: Optional[Callable[[DownloadProgress], None]] = None
    ) -> ModelInfo:
        """
        Download a model from HuggingFace Hub
        
        Args:
            repo_id: HuggingFace repository ID (e.g., "sentence-transformers/all-MiniLM-L6-v2")
            filename: Specific file to download (e.g., "pytorch_model.bin")
            model_id: Optional custom ID for the model. If not provided, uses repo_id
            progress_callback: Optional callback for progress updates
            
        Returns:
            ModelInfo object with download details
        """
        if model_id is None:
            model_id = f"{repo_id}/{filename}".replace("/", "_")
        
        # Check if already downloaded
        if self.is_model_downloaded(model_id):
            return self.registry[model_id]
        
        # Create model info
        model_info = ModelInfo(
            model_id=model_id,
            repo_id=repo_id,
            filename=filename,
            status=DownloadStatus.DOWNLOADING
        )
        
        self.active_downloads[model_id] = model_info
        
        if progress_callback:
            if model_id not in self.download_callbacks:
                self.download_callbacks[model_id] = []
            self.download_callbacks[model_id].append(progress_callback)
        
        try:
            # Create model-specific directory
            model_dir = self.models_dir / model_id.replace("/", "_")
            model_dir.mkdir(parents=True, exist_ok=True)
            
            # Download the file
            print(f"Downloading {repo_id}/{filename} to {model_dir}")
            
            # Use hf_hub_download for single file download
            local_path = await asyncio.to_thread(
                hf_hub_download,
                repo_id=repo_id,
                filename=filename,
                cache_dir=str(model_dir),
                local_dir=str(model_dir),
                local_dir_use_symlinks=False
            )
            
            # Get file size
            file_size = os.path.getsize(local_path)
            
            # Update model info
            model_info.local_path = local_path
            model_info.size_bytes = file_size
            model_info.status = DownloadStatus.COMPLETED
            model_info.progress = 100.0
            
            # Save to registry
            self.registry[model_id] = model_info
            self._save_registry()
            
            # Send final progress update
            if progress_callback:
                progress = DownloadProgress(
                    model_id=model_id,
                    progress=100.0,
                    downloaded_bytes=file_size,
                    total_bytes=file_size,
                    status=DownloadStatus.COMPLETED
                )
                progress_callback(progress)
            
            print(f"Successfully downloaded {model_id}")
            return model_info
            
        except HfHubHTTPError as e:
            error_msg = f"HuggingFace Hub error: {str(e)}"
            print(error_msg)
            model_info.status = DownloadStatus.FAILED
            model_info.error = error_msg
            
            if progress_callback:
                progress = DownloadProgress(
                    model_id=model_id,
                    progress=model_info.progress,
                    downloaded_bytes=0,
                    total_bytes=0,
                    status=DownloadStatus.FAILED,
                    error=error_msg
                )
                progress_callback(progress)
            
            raise
            
        except Exception as e:
            error_msg = f"Download error: {str(e)}"
            print(error_msg)
            model_info.status = DownloadStatus.FAILED
            model_info.error = error_msg
            
            if progress_callback:
                progress = DownloadProgress(
                    model_id=model_id,
                    progress=model_info.progress,
                    downloaded_bytes=0,
                    total_bytes=0,
                    status=DownloadStatus.FAILED,
                    error=error_msg
                )
                progress_callback(progress)
            
            raise
            
        finally:
            # Clean up
            if model_id in self.active_downloads:
                del self.active_downloads[model_id]
            if model_id in self.download_callbacks:
                del self.download_callbacks[model_id]
    
    def delete_model(self, model_id: str) -> bool:
        """
        Delete a downloaded model
        
        Args:
            model_id: ID of the model to delete
            
        Returns:
            True if successful, False otherwise
        """
        model_info = self.registry.get(model_id)
        if not model_info:
            return False
        
        try:
            # Delete model directory
            if model_info.local_path:
                model_dir = Path(model_info.local_path).parent
                if model_dir.exists():
                    shutil.rmtree(model_dir)
            
            # Remove from registry
            del self.registry[model_id]
            self._save_registry()
            
            print(f"Successfully deleted model {model_id}")
            return True
            
        except Exception as e:
            print(f"Error deleting model {model_id}: {e}")
            return False
    
    def get_download_status(self, model_id: str) -> Optional[DownloadProgress]:
        """
        Get the current download status for a model
        
        Args:
            model_id: ID of the model
            
        Returns:
            DownloadProgress object or None if not downloading
        """
        model_info = self.active_downloads.get(model_id)
        if not model_info:
            # Check if it's in the registry
            model_info = self.registry.get(model_id)
            if not model_info:
                return None
        
        return DownloadProgress(
            model_id=model_id,
            progress=model_info.progress,
            downloaded_bytes=model_info.size_bytes or 0,
            total_bytes=model_info.size_bytes or 0,
            status=model_info.status,
            error=model_info.error
        )
    
    async def search_models(
        self,
        query: str,
        limit: int = 10,
        task: Optional[str] = None
    ) -> List[Dict]:
        """
        Search for models on HuggingFace Hub
        
        Args:
            query: Search query
            limit: Maximum number of results
            task: Optional task filter (e.g., "text-generation", "text-classification")
            
        Returns:
            List of model information dictionaries
        """
        try:
            models = await asyncio.to_thread(
                lambda: list(self.hf_api.list_models(
                    search=query,
                    limit=limit,
                    task=task,
                    sort="downloads",
                    direction=-1
                ))
            )
            
            results = []
            for model in models:
                results.append({
                    "model_id": model.modelId,
                    "downloads": model.downloads or 0,
                    "likes": model.likes or 0,
                    "tags": model.tags or [],
                    "pipeline_tag": model.pipeline_tag,
                    "library_name": model.library_name
                })
            
            return results
            
        except Exception as e:
            print(f"Error searching models: {e}")
            return []
    
    async def list_repo_files_api(self, repo_id: str) -> List[str]:
        """
        List all files in a HuggingFace repository
        
        Args:
            repo_id: Repository ID
            
        Returns:
            List of file paths in the repository
        """
        try:
            files = await asyncio.to_thread(
                list_repo_files,
                repo_id=repo_id
            )
            return files
        except Exception as e:
            print(f"Error listing repo files: {e}")
            return []
