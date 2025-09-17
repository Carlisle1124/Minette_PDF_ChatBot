from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List, Tuple

import chromadb
from chromadb.config import Settings

from utils.chunker import chunk_text
from utils.ollama_client import OllamaClient


DEFAULT_COLLECTION = "documents"


@dataclass
class RetrievedContext:
    text: str
    score: float


class RAGPipeline:
    def __init__(
        self,
        persist_directory: str = "backend/db/chrome_store",
        collection_name: str = DEFAULT_COLLECTION,
        top_k: int = 5,
    ) -> None:
        os.makedirs(persist_directory, exist_ok=True)
        self.client = chromadb.PersistentClient(
            path=persist_directory,
            settings=Settings(anonymized_telemetry=False),
        )
        self.collection = self.client.get_or_create_collection(collection_name)
        self.ollama = OllamaClient()
        self.top_k = top_k

    # --- Ingestion ---
    def ingest_document(self, doc_id: str, text: str, metadata: dict | None = None) -> int:
        chunks = chunk_text(text)
        if not chunks:
            return 0
        embeddings = [self.ollama.embed(chunk) for chunk in chunks]
        ids = [f"{doc_id}:{i}" for i in range(len(chunks))]
        metadatas = [{"doc_id": doc_id, **(metadata or {})} for _ in chunks]
        self.collection.add(ids=ids, documents=chunks, embeddings=embeddings, metadatas=metadatas)
        return len(chunks)

    # --- Retrieval ---
    def retrieve(self, query: str, k: int | None = None) -> List[RetrievedContext]:
        k = k or self.top_k
        query_embed = self.ollama.embed(query)
        results = self.collection.query(query_embeddings=[query_embed], n_results=k)

        docs = (results.get("documents") or [[]])[0]
        distances = (results.get("distances") or [[]])[0]
        out: List[RetrievedContext] = []
        for doc, dist in zip(docs, distances):
            score = 1.0 - float(dist) if dist is not None else 0.0
            out.append(RetrievedContext(text=doc, score=score))
        return out

    # --- Generate ---
    def generate(self, query: str, contexts: List[RetrievedContext]) -> str:
        system = (
            "You are a helpful assistant. Answer using only the provided context. "
            "If the context is insufficient, say you don't know."
        )
        context_block = "\n\n".join(f"[Context {i+1}]\n{c.text}" for i, c in enumerate(contexts))
        user_prompt = f"Question: {query}\n\nContext:\n{context_block}"
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_prompt},
        ]
        return self.ollama.chat(messages)

    # --- Full RAG ---
    def rag_answer(self, query: str, k: int | None = None) -> Tuple[str, List[RetrievedContext]]:
        contexts = self.retrieve(query, k)
        answer = self.generate(query, contexts)
        return answer, contexts

# RAG logic (retrieval + generation)