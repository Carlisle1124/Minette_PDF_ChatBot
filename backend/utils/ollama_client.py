"""
Thin client for interacting with the local Ollama server.

Endpoints used:
- POST /api/embeddings { model, prompt }
- POST /api/chat { model, messages: [{role, content}], stream }

Defaults are chosen to work out-of-the-box with common local models.
"""

from __future__ import annotations

import os
import requests
from typing import Dict, List, Optional


class OllamaClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        chat_model: Optional[str] = None,
        embed_model: Optional[str] = None,
        request_timeout_seconds: int = 120,
    ) -> None:
        self.base_url = base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        # You can change these defaults to any locally available models
        self.chat_model = chat_model or os.getenv("OLLAMA_CHAT_MODEL", "llama3.1:8b")
        self.embed_model = embed_model or os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
        self.timeout = request_timeout_seconds

    # --- Embeddings ---
    def embed(self, text: str) -> List[float]:
        if not text:
            return []
        url = f"{self.base_url}/api/embeddings"
        payload: Dict[str, object] = {"model": self.embed_model, "prompt": text}
        resp = requests.post(url, json=payload, timeout=self.timeout)
        resp.raise_for_status()
        data = resp.json()
        embedding = data.get("embedding")
        if not isinstance(embedding, list):
            raise RuntimeError("Unexpected embeddings response from Ollama")
        return embedding  # type: ignore[return-value]

    # --- Chat Completion ---
    def chat(self, messages: List[Dict[str, str]], temperature: float = 0.2) -> str:
        url = f"{self.base_url}/api/chat"
        payload: Dict[str, object] = {
            "model": self.chat_model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature},
        }
        resp = requests.post(url, json=payload, timeout=self.timeout)
        resp.raise_for_status()
        data = resp.json()
        # Format documented by Ollama: { message: { role, content } }
        message = data.get("message", {})
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str):
            # Fallback for /api/generate style responses
            content = data.get("response")
        if not isinstance(content, str):
            raise RuntimeError("Unexpected chat response from Ollama")
        return content


__all__ = ["OllamaClient"]

#This will be the Ollama API calls