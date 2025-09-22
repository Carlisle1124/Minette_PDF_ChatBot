from __future__ import annotations

import io
import os
import re
from typing import List

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json

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
try:
    rag = RAGPipeline(persist_directory=_persist_dir)
    print("RAG pipeline initialized successfully")
except Exception as e:
    print(f"Error initializing RAG pipeline: {str(e)}")
    rag = None


class ChatRequest(BaseModel):
    message: str
    top_k: int = 5
    filter_documents: List[str] | None = None  # Optional list of document IDs to filter by


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/ingest/pdf")
async def ingest_pdf(file: UploadFile = File(...), replace: bool = False) -> dict:
    if pdfplumber is None:
        raise RuntimeError("pdfplumber is required. Install with: pip install pdfplumber")

    print(f"\n=== INGESTING PDF ===")
    print(f"Filename: {file.filename}")
    
    # Only clear existing documents if replace=True
    if replace:
        print("Replace mode: Auto-clearing existing documents before ingestion...")
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


@app.post("/ingest/pdf/add")
async def add_pdf(file: UploadFile = File(...)) -> dict:
    if pdfplumber is None:
        raise RuntimeError("pdfplumber is required. Install with: pip install pdfplumber")

    print(f"\n=== ADDING PDF TO CONTEXT ===")
    print(f"Filename: {file.filename}")
    
    content = await file.read()
    
    # Save the uploaded file
    upload_dir = os.path.join(_base_dir, "uploaded_docs")
    os.makedirs(upload_dir, exist_ok=True)
    
    file_path = os.path.join(upload_dir, file.filename or "document.pdf")
    doc_id = os.path.splitext(file.filename or "document")[0]
    
    # Check if document already exists in vector store
    existing_info = rag.get_all_documents_info()
    existing_docs = existing_info.get("documents", {})
    
    if doc_id in existing_docs:
        print(f"Document {doc_id} already exists in context. Removing existing chunks first...")
        rag.remove_document(doc_id)
    
    print(f"Saving file to: {file_path}")
    
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Extract text using pdfplumber
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        pages_text = [page.extract_text() or "" for page in pdf.pages]
    full_text = "\n\n".join(pages_text)
    
    print(f"Document ID: {doc_id}")
    print(f"Text length: {len(full_text)} characters")
    print(f"Text preview: {full_text[:200]}...")
    
    num_chunks = rag.ingest_document(doc_id=doc_id, text=full_text, metadata={"filename": file.filename})
    
    print(f"Addition complete: {num_chunks} chunks added")
    print("===============================\n")
    
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


@app.post("/chat/stream")
def chat_stream(req: ChatRequest):
    """
    Stream the chat response as Server-Sent Events.
    """
    print(f"\n=== STREAMING CHAT REQUEST ===")
    print(f"Question: {req.message}")
    print(f"Top K: {req.top_k}")
    print(f"Filter Documents: {req.filter_documents}")
    
    def generate_stream():
        contexts_sent = False
        full_answer = ""
        
        try:
            for content_chunk, contexts in rag.rag_answer_stream(
                req.message, 
                req.top_k, 
                req.filter_documents
            ):
                full_answer += content_chunk
                
                # Send contexts only with the first chunk
                if not contexts_sent and contexts:
                    contexts_data = {
                        "type": "contexts",
                        "data": [{"text": c.text, "score": c.score} for c in contexts]
                    }
                    yield f"data: {json.dumps(contexts_data)}\n\n"
                    contexts_sent = True
                
                # Send content chunk
                chunk_data = {
                    "type": "content",
                    "data": content_chunk
                }
                yield f"data: {json.dumps(chunk_data)}\n\n"
            
            # Send completion signal
            done_data = {
                "type": "done",
                "data": {"full_answer": full_answer}
            }
            yield f"data: {json.dumps(done_data)}\n\n"
            
            print(f"Streaming complete. Full answer length: {len(full_answer)} characters")
            print("===========================\n")
            
        except Exception as e:
            print(f"Streaming error: {str(e)}")
            error_data = {
                "type": "error",
                "data": {"message": str(e)}
            }
            yield f"data: {json.dumps(error_data)}\n\n"
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Type": "text/plain; charset=utf-8"
        }
    )


@app.get("/debug/documents")
def debug_documents() -> dict:
    """Debug endpoint to see what documents are in the vector store"""
    print("\n=== DEBUG: Vector Store Contents ===")
    if rag is None:
        return {"error": "RAG pipeline not initialized"}
    try:
        info = rag.get_all_documents_info()
        print("====================================\n")
        return info
    except Exception as e:
        print(f"Error getting documents info: {str(e)}")
        return {"error": str(e)}


@app.delete("/documents/clear")
async def clear_all_documents() -> dict:
    print("\n=== CLEAR ALL DOCUMENTS REQUEST ===")
    try:
        # Clear all files from upload directory
        upload_dir = os.path.join(_base_dir, "uploaded_docs")
        print(f"Clearing files from: {upload_dir}")
        if os.path.exists(upload_dir):
            files_before = os.listdir(upload_dir)
            print(f"Files before clearing: {files_before}")
            for filename in os.listdir(upload_dir):
                file_path = os.path.join(upload_dir, filename)
                if os.path.isfile(file_path):
                    os.remove(file_path)
                    print(f"Removed file: {filename}")
        
        # Clear the entire vector store
        print("Clearing vector store...")
        success = rag.clear_all_documents()
        print(f"Vector store clear success: {success}")
        
        if success:
            print("=== CLEAR ALL COMPLETED SUCCESSFULLY ===")
            return {"message": "All documents successfully cleared"}
        else:
            print("=== CLEAR ALL FAILED: VECTOR STORE CLEAR FAILED ===")
            raise HTTPException(status_code=500, detail="Failed to clear vector store")
    except Exception as e:
        print(f"=== CLEAR ALL ERROR: {str(e)} ===")
        raise HTTPException(status_code=500, detail=str(e))


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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, timeout_keep_alive=500)

#this will be FastAPI/Flask entrypoint