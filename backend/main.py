from __future__ import annotations

import io
import os
import re
from typing import List

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from utils.ollama_client import OllamaClient
from utils.chunker import chunk_text
from rag_pipeline import RAGPipeline

try:
    import pdfplumber  # type: ignore
except Exception:
    pdfplumber = None

app = FastAPI(title="Minette PDF Ollama API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ollama = OllamaClient()

# Persist ChromaDB under backend/db/chrome_store regardless of CWD
_base_dir = os.path.dirname(__file__)
_persist_dir = os.path.join(_base_dir, "db", "chrome_store")
rag = RAGPipeline(persist_directory=_persist_dir)


class ChatRequest(BaseModel):
    message: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/ingest/pdf")
async def ingest_pdf(file: UploadFile = File(...)) -> dict:
    if pdfplumber is None:
        raise RuntimeError("pdfplumber is required. Install with: pip install pdfplumber")

    print(f"\n=== INGESTING PDF ===")
    print(f"Filename: {file.filename}")
    
    # Always clear existing documents before adding new ones
    print("Auto-clearing existing documents before ingestion...")
    rag.clear_all_documents()
    
    content = await file.read()
    
    # Save the uploaded file
    upload_dir = os.path.join(_base_dir, "uploaded_docs")
    os.makedirs(upload_dir, exist_ok=True)
    
    # Clear existing files in upload directory
    if os.path.exists(upload_dir):
        for existing_file in os.listdir(upload_dir):
            existing_path = os.path.join(upload_dir, existing_file)
            if os.path.isfile(existing_path):
                os.remove(existing_path)
                print(f"Removed existing file: {existing_file}")
    
    file_path = os.path.join(upload_dir, file.filename or "document.pdf")
    
    print(f"Saving file to: {file_path}")
    
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Extract text using pdfplumber
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        pages_text = [page.extract_text() or "" for page in pdf.pages]
    full_text = "\n\n".join(pages_text)
    doc_id = os.path.splitext(file.filename or "document")[0]
    
    print(f"Document ID: {doc_id}")
    print(f"Text length: {len(full_text)} characters")
    print(f"Text preview: {full_text[:200]}...")
    
    num_chunks = rag.ingest_document(doc_id=doc_id, text=full_text, metadata={"filename": file.filename})
    
    print(f"Ingestion complete: {num_chunks} chunks created")
    print("====================\n")
    
    return {"filename": file.filename, "chunks": num_chunks}


@app.post("/chat")
def chat(req: ChatRequest) -> dict:
    print(f"\n=== CHAT REQUEST ===")
    print(f"Question: {req.message}")
    
    answer, contexts = rag.rag_answer(req.message)
    
    print(f"Generated answer length: {len(answer)} characters")
    print(f"Answer preview: {answer[:200]}...")
    print(f"Used {len(contexts)} context chunks")
    print("===================\n")

    return {
        "answer": answer,
        "contexts": [
            {"text": c.text, "score": c.score}
            for c in contexts
        ],
    }


@app.get("/debug/documents")
def debug_documents() -> dict:
    """Debug endpoint to see what documents are in the vector store"""
    print("\n=== DEBUG: Vector Store Contents ===")
    info = rag.get_all_documents_info()
    print("====================================\n")
    return info


@app.delete("/documents/{filename}")
async def delete_document(filename: str) -> dict:
    try:
        # Path where documents are stored
        file_path = os.path.join(_base_dir, "uploaded_docs", filename)
        
        # Check if the file exists and delete it
        if os.path.exists(file_path):
            os.remove(file_path)
        
        # Remove document from the RAG pipeline/vector store
        doc_id = os.path.splitext(filename)[0]
        success = rag.remove_document(doc_id)
        
        if success:
            return {"message": f"Document {filename} successfully deleted"}
        else:
            raise HTTPException(status_code=500, detail=f"Failed to remove {filename} from vector store")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/documents/clear")
async def clear_all_documents() -> dict:
    try:
        # Clear all files from upload directory
        upload_dir = os.path.join(_base_dir, "uploaded_docs")
        if os.path.exists(upload_dir):
            for filename in os.listdir(upload_dir):
                file_path = os.path.join(upload_dir, filename)
                if os.path.isfile(file_path):
                    os.remove(file_path)
        
        # Clear the entire vector store
        success = rag.clear_all_documents()
        
        if success:
            return {"message": "All documents successfully cleared"}
        else:
            raise HTTPException(status_code=500, detail="Failed to clear vector store")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, timeout_keep_alive=500)

#this will be FastAPI/Flask entrypoint