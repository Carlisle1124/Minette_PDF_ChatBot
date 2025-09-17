"""
Embedding helper built on top of the local Ollama client.
"""

from __future__ import annotations

from typing import Iterable, List

from .ollama_client import OllamaClient


class Embedder:
    def __init__(self, client: OllamaClient | None = None) -> None:
        self.client = client or OllamaClient()

    def embed_text(self, text: str) -> List[float]:
        return self.client.embed(text)

    def embed_texts(self, texts: Iterable[str]) -> List[List[float]]:
        return [self.embed_text(t) for t in texts]


__all__ = ["Embedder"]

# Embedding functions for the backend RAG pipeline