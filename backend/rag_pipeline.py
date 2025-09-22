from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List, Tuple

# Disable Chroma telemetry as early as possible (before import)
os.environ.setdefault("CHROMA_TELEMETRY_IMPLEMENTATION", "none")
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")

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
        persist_directory: str | None = None,
        collection_name: str = DEFAULT_COLLECTION,
        top_k: int = 5,
    ) -> None:
        # Ensure Chroma telemetry is fully disabled to avoid noisy warnings
        os.environ.setdefault("CHROMA_TELEMETRY_IMPLEMENTATION", "none")

        # Resolve persist directory relative to this file if not provided
        if not persist_directory:
            base_dir = os.path.dirname(__file__)
            persist_directory = os.path.join(base_dir, "db", "chrome_store")

        os.makedirs(persist_directory, exist_ok=True)
        self.client = chromadb.PersistentClient(
            path=persist_directory,
            settings=Settings(anonymized_telemetry=False),
        )
        self.collection_name = collection_name
        self.collection = self.client.get_or_create_collection(collection_name)
        self.ollama = OllamaClient()
        self.top_k = top_k

    # --- Ingestion ---
    def ingest_document(self, doc_id: str, text: str, metadata: dict | None = None) -> int:
        chunks = chunk_text(text)
        if not chunks:
            print(f"No chunks generated for document: {doc_id}")
            return 0
        
        print(f"Ingesting document '{doc_id}' with {len(chunks)} chunks")
        print(f"Document metadata: {metadata}")
        
        embeddings = [self.ollama.embed(chunk) for chunk in chunks]
        ids = [f"{doc_id}:{i}" for i in range(len(chunks))]
        metadatas = [{"doc_id": doc_id, **(metadata or {})} for _ in chunks]
        
        print(f"Generated chunk IDs: {ids[:3]}{'...' if len(ids) > 3 else ''}")
        
        self.collection.add(ids=ids, documents=chunks, embeddings=embeddings, metadatas=metadatas)
        
        # Verify ingestion
        collection_count = self.collection.count()
        print(f"Total chunks in collection after ingestion: {collection_count}")
        
        return len(chunks)

    def remove_document(self, doc_id: str) -> bool:
        """
        Remove all chunks associated with a document from the vector store
        """
        try:
            print(f"Attempting to remove document: {doc_id}")
            # Get all document IDs that match the pattern doc_id:*
            collection_data = self.collection.get()
            print(f"Collection has {len(collection_data.get('ids', []))} total chunks")
            ids_to_delete = []
            
            if collection_data and collection_data.get("ids"):
                for chunk_id in collection_data["ids"]:
                    print(f"Checking chunk_id: {chunk_id}")
                    if chunk_id.startswith(f"{doc_id}:"):
                        ids_to_delete.append(chunk_id)
                        print(f"Found chunk to delete: {chunk_id}")
            
            print(f"Found {len(ids_to_delete)} chunks to delete for doc_id: {doc_id}")
            
            if ids_to_delete:
                self.collection.delete(ids=ids_to_delete)
                print(f"Successfully deleted {len(ids_to_delete)} chunks for document: {doc_id}")
                
                # Verify deletion
                after_data = self.collection.get()
                print(f"After deletion, collection has {len(after_data.get('ids', []))} chunks")
            else:
                print(f"No chunks found for document: {doc_id}")
            
            return True
        except Exception as e:
            print(f"Error removing document {doc_id}: {str(e)}")
            return False

    def clear_all_documents(self) -> bool:
        """
        Clear all documents from the vector store
        """
        try:
            # Log what we're about to clear
            collection_count = self.collection.count()
            print(f"Clearing {collection_count} chunks from vector store")
            
            # Get all document IDs and delete them individually
            collection_data = self.collection.get()
            ids_to_delete = collection_data.get("ids", [])
            
            if ids_to_delete:
                print(f"Deleting {len(ids_to_delete)} chunks individually")
                # Delete in batches if there are many
                batch_size = 100
                for i in range(0, len(ids_to_delete), batch_size):
                    batch = ids_to_delete[i:i + batch_size]
                    self.collection.delete(ids=batch)
                    print(f"Deleted batch of {len(batch)} chunks")
            
            # Verify clearing worked
            new_count = self.collection.count()
            print(f"Vector store cleared. New count: {new_count}")
            return True
        except Exception as e:
            print(f"Error clearing all documents: {str(e)}")
            return False

    def get_all_documents_info(self) -> dict:
        """
        Get information about all documents in the vector store
        """
        try:
            collection_data = self.collection.get()
            
            info = {
                "total_chunks": len(collection_data.get("ids", [])),
                "documents": {}
            }
            
            if collection_data and collection_data.get("ids"):
                for chunk_id, metadata in zip(collection_data["ids"], collection_data.get("metadatas", [])):
                    if metadata:
                        doc_id = metadata.get("doc_id", "unknown")
                        filename = metadata.get("filename", "unknown")
                        
                        if doc_id not in info["documents"]:
                            info["documents"][doc_id] = {
                                "filename": filename,
                                "chunk_count": 0,
                                "chunk_ids": []
                            }
                        
                        info["documents"][doc_id]["chunk_count"] += 1
                        info["documents"][doc_id]["chunk_ids"].append(chunk_id)
            
            print(f"Current vector store contents: {info}")
            return info
        except Exception as e:
            print(f"Error getting documents info: {str(e)}")
            return {"error": str(e)}

    # --- Retrieval ---
    def retrieve(self, query: str, k: int | None = None, filter_doc_ids: List[str] | None = None) -> List[RetrievedContext]:
        k = k or self.top_k
        query_embed = self.ollama.embed(query)
        
        # Check if collection is empty first
        collection_count = self.collection.count()
        print(f"Collection has {collection_count} total chunks")
        
        if collection_count == 0:
            print("No documents in collection to retrieve from")
            return []
        
        # Build filter for specific documents if provided
        where_filter = None
        if filter_doc_ids:
            print(f"Filtering retrieval to documents: {filter_doc_ids}")
            where_filter = {"doc_id": {"$in": filter_doc_ids}}
        
        # Ensure k doesn't exceed available documents
        k = min(k, collection_count)
        print(f"Retrieving top {k} chunks for query: '{query[:50]}...'")
        
        try:
            # Use where parameter to filter by document IDs if specified
            if where_filter:
                results = self.collection.query(
                    query_embeddings=[query_embed], 
                    n_results=k,
                    where=where_filter
                )
            else:
                results = self.collection.query(query_embeddings=[query_embed], n_results=k)
            
            # Log what we retrieved
            docs = (results.get("documents") or [[]])[0]
            distances = (results.get("distances") or [[]])[0]
            ids = (results.get("ids") or [[]])[0]
            metadatas = (results.get("metadatas") or [[]])[0]
            
            print(f"Retrieved {len(docs)} chunks:")
            for i, (chunk_id, metadata, distance) in enumerate(zip(ids, metadatas, distances)):
                doc_id = metadata.get("doc_id", "unknown") if metadata else "unknown"
                filename = metadata.get("filename", "unknown") if metadata else "unknown"
                print(f"  {i+1}. ID: {chunk_id}, Doc: {doc_id}, File: {filename}, Distance: {distance:.4f}")
                print(f"     Content preview: {docs[i][:100]}...")
                
        except Exception as e:
            print(f"ChromaDB query error: {e}")
            return []

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

    def generate_stream(self, query: str, contexts: List[RetrievedContext]):
        """
        Stream the generated response word by word.
        """
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
        
        # Stream from Ollama
        for content_chunk in self.ollama.chat_stream(messages):
            yield content_chunk

    # --- Full RAG ---
    def rag_answer(self, query: str, k: int | None = None) -> Tuple[str, List[RetrievedContext]]:
        contexts = self.retrieve(query, k)
        answer = self.generate(query, contexts)
        return answer, contexts

    def rag_answer_stream(self, query: str, k: int | None = None, filter_doc_ids: List[str] | None = None):
        """
        Stream the RAG answer and return contexts separately.
        Yields tuples of (content_chunk, contexts) where contexts is only populated on first yield.
        """
        contexts = self.retrieve(query, k, filter_doc_ids)
        
        # Yield contexts with first chunk
        first_chunk = True
        for content_chunk in self.generate_stream(query, contexts):
            if first_chunk:
                yield content_chunk, contexts
                first_chunk = False
            else:
                yield content_chunk, []

# RAG logic (retrieval + generation)