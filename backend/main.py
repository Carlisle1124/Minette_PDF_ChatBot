from __future__ import annotations

import io
import os
import re
import uuid
from typing import List

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json

from utils.ollama_client import OllamaClient
from utils.chunker import chunk_text
from rag_pipeline import RAGPipeline
from chat_rag_manager import ChatRAGManager

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

# Initialize per-chat RAG management system
_base_dir = os.path.dirname(__file__)
_persist_dir = os.path.join(_base_dir, "db", "chat_contexts")
_docs_dir = os.path.join(_base_dir, "uploaded_docs")
try:
    chat_rag_manager = ChatRAGManager(_persist_dir, _docs_dir)
    print("Chat RAG Manager initialized successfully")
except Exception as e:
    print(f"Error initializing Chat RAG Manager: {str(e)}")
    chat_rag_manager = None


class ChatRequest(BaseModel):
    message: str
    top_k: int = 5
    chat_id: str | None = None  # Chat ID for context switching
    filter_documents: List[str] | None = None  # Optional list of document IDs to filter by
    max_tokens: int | None = None  # Maximum tokens for response generation

class ChatSwitchRequest(BaseModel):
    chat_id: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/chat/switch")
def switch_chat(req: ChatSwitchRequest) -> dict:
    """Switch to a specific chat context"""
    if chat_rag_manager is None:
        raise HTTPException(status_code=500, detail="Chat RAG manager not initialized")
    
    try:
        rag = chat_rag_manager.set_current_chat(req.chat_id)
        docs_info = chat_rag_manager.get_current_chat_documents()
        return {
            "message": f"Switched to chat {req.chat_id}",
            "chat_id": req.chat_id,
            "documents": docs_info.get("documents", {}),
            "total_chunks": docs_info.get("total_chunks", 0)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to switch chat: {str(e)}")


@app.post("/chat/new")
def new_chat() -> dict:
    """Start a new chat (clear current context)"""
    if chat_rag_manager is None:
        raise HTTPException(status_code=500, detail="Chat RAG manager not initialized")
    
    chat_rag_manager.clear_current_chat()
    return {"message": "New chat started - no active context"}


@app.get("/chat/current")
def get_current_chat() -> dict:
    """Get information about current chat context"""
    if chat_rag_manager is None:
        raise HTTPException(status_code=500, detail="Chat RAG manager not initialized")
    
    if chat_rag_manager.current_chat_id:
        docs_info = chat_rag_manager.get_current_chat_documents()
        return {
            "chat_id": chat_rag_manager.current_chat_id,
            "has_context": True,
            "documents": docs_info.get("documents", {}),
            "total_chunks": docs_info.get("total_chunks", 0)
        }
    else:
        return {
            "chat_id": None,
            "has_context": False,
            "documents": {},
            "total_chunks": 0
        }


@app.post("/ingest/pdf")
async def ingest_pdf(file: UploadFile = File(...), chat_id: str | None = None, replace: bool = False) -> dict:
    if pdfplumber is None:
        raise RuntimeError("pdfplumber is required. Install with: pip install pdfplumber")
    
    if chat_rag_manager is None:
        raise HTTPException(status_code=500, detail="Chat RAG manager not initialized")

    print(f"\n=== INGESTING PDF TO CHAT ===")
    print(f"Filename: {file.filename}")
    print(f"Chat ID: {chat_id}")
    
    # Set chat context if provided
    if chat_id:
        chat_rag_manager.set_current_chat(chat_id)
    elif not chat_rag_manager.current_chat_id:
        raise HTTPException(status_code=400, detail="No chat_id provided and no current chat context")
    
    # Only clear existing documents if replace=True
    if replace:
        print("Replace mode: Auto-clearing existing documents for current chat...")
        chat_rag_manager.clear_current_chat_documents()
    
    content = await file.read()
    # Generate a unique document ID using UUID instead of filename
    doc_id = f"doc_{uuid.uuid4().hex[:8]}"
    
    # Save file to chat-specific folder
    file_path = chat_rag_manager.save_file_to_current_chat(file.filename or "document.pdf", content)
    print(f"Saved file to: {file_path}")
    
    # Extract text using pdfplumber
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        pages_text = [page.extract_text() or "" for page in pdf.pages]
    full_text = "\n\n".join(pages_text)
    
    print(f"Document ID: {doc_id}")
    print(f"Text length: {len(full_text)} characters")
    print(f"Text preview: {full_text[:200]}...")
    
    # Ingest to current chat's RAG context
    num_chunks = chat_rag_manager.ingest_document_to_current_chat(doc_id, full_text, file.filename or "document.pdf")
    
    print(f"Ingestion complete: {num_chunks} chunks created for chat {chat_rag_manager.current_chat_id}")
    print("===============================\n")
    
    return {
        "filename": file.filename,
        "chunks": num_chunks,
        "chat_id": chat_rag_manager.current_chat_id,
        "doc_id": doc_id
    }


@app.post("/ingest/pdf/add")
async def add_pdf(file: UploadFile = File(...), chat_id: str | None = None) -> dict:
    if pdfplumber is None:
        raise RuntimeError("pdfplumber is required. Install with: pip install pdfplumber")
    
    if chat_rag_manager is None:
        raise HTTPException(status_code=500, detail="Chat RAG manager not initialized")

    print(f"\n=== ADDING PDF TO CHAT CONTEXT ===")
    print(f"Filename: {file.filename}")
    print(f"Chat ID: {chat_id}")
    
    # Set chat context if provided
    if chat_id:
        chat_rag_manager.set_current_chat(chat_id)
    elif not chat_rag_manager.current_chat_id:
        raise HTTPException(status_code=400, detail="No chat_id provided and no current chat context")
    
    content = await file.read()
    # Generate a unique document ID using UUID instead of filename
    doc_id = f"doc_{uuid.uuid4().hex[:8]}"
    
    # Save file to chat-specific folder
    file_path = chat_rag_manager.save_file_to_current_chat(file.filename or "document.pdf", content)
    print(f"Saved file to: {file_path}")
    
    # Extract text using pdfplumber
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        pages_text = [page.extract_text() or "" for page in pdf.pages]
    full_text = "\n\n".join(pages_text)
    
    print(f"Document ID: {doc_id}")
    print(f"Text length: {len(full_text)} characters")
    print(f"Text preview: {full_text[:200]}...")
    
    # Ingest to current chat's RAG context
    num_chunks = chat_rag_manager.ingest_document_to_current_chat(doc_id, full_text, file.filename or "document.pdf")
    
    print(f"Addition complete: {num_chunks} chunks added to chat {chat_rag_manager.current_chat_id}")
    print("===============================\n")
    
    return {
        "filename": file.filename,
        "chunks": num_chunks,
        "chat_id": chat_rag_manager.current_chat_id,
        "doc_id": doc_id
    }


@app.post("/chat")
def chat(req: ChatRequest) -> dict:
    if chat_rag_manager is None:
        raise HTTPException(status_code=500, detail="Chat RAG manager not initialized")
    
    print(f"\n=== CHAT REQUEST ===")
    print(f"Question: {req.message}")
    print(f"Chat ID: {req.chat_id}")
    print(f"Max Tokens: {req.max_tokens}")
    
    # Set chat context if provided
    if req.chat_id:
        chat_rag_manager.set_current_chat(req.chat_id)
    
    if not chat_rag_manager.current_chat_id:
        raise HTTPException(status_code=400, detail="No active chat context")
    
    try:
        rag = chat_rag_manager.get_current_rag()
        if not rag:
            raise HTTPException(status_code=500, detail="No RAG instance for current chat")
        
        # Debug: Check if we have any documents in the current chat context
        docs_info = rag.get_all_documents_info()
        total_chunks = docs_info.get("total_chunks", 0)
        print(f"Current chat has {total_chunks} total chunks available for retrieval")
        
        if total_chunks == 0:
            print("WARNING: No documents found in current chat context - AI will have no context to work with")
        
        answer, contexts = rag.rag_answer(req.message, max_tokens=req.max_tokens)
        
        print(f"Generated answer length: {len(answer)} characters")
        print(f"Answer preview: {answer[:200]}...")
        print(f"Used {len(contexts)} context chunks")
        print(f"Current chat: {chat_rag_manager.current_chat_id}")
        print("===================\n")
        
        return {
            "answer": answer,
            "contexts": [
                {"text": c.text, "score": c.score}
                for c in contexts
            ],
            "chat_id": chat_rag_manager.current_chat_id,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


@app.post("/chat/stream")
def chat_stream(req: ChatRequest):
    """
    Stream the chat response as Server-Sent Events.
    """
    if chat_rag_manager is None:
        raise HTTPException(status_code=500, detail="Chat RAG manager not initialized")
    
    print(f"\n=== STREAMING CHAT REQUEST ===")
    print(f"Question: {req.message}")
    print(f"Chat ID: {req.chat_id}")
    print(f"Top K: {req.top_k}")
    print(f"Max Tokens: {req.max_tokens}")
    
    # Set chat context if provided
    if req.chat_id:
        chat_rag_manager.set_current_chat(req.chat_id)
    
    if not chat_rag_manager.current_chat_id:
        raise HTTPException(status_code=400, detail="No active chat context")
    
    def generate_stream():
        contexts_sent = False
        full_answer = ""
        
        try:
            rag = chat_rag_manager.get_current_rag()
            if not rag:
                raise Exception("No RAG instance for current chat")
            
            # Debug: Check if we have any documents in the current chat context
            docs_info = rag.get_all_documents_info()
            total_chunks = docs_info.get("total_chunks", 0)
            print(f"Streaming chat: Current chat has {total_chunks} total chunks available")
            
            if total_chunks == 0:
                print("WARNING: No documents in current chat context for streaming - AI will have no context")
                
            for content_chunk, contexts in rag.rag_answer_stream(
                req.message, 
                req.top_k,
                max_tokens=req.max_tokens
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


@app.get("/chats")
def list_all_chats() -> dict:
    """List all available chat sessions with their metadata"""
    if chat_rag_manager is None:
        raise HTTPException(status_code=500, detail="Chat RAG manager not initialized")
    
    try:
        chat_ids = chat_rag_manager.list_all_chats()
        chats_info = []
        
        for chat_id in chat_ids:
            try:
                docs_info = chat_rag_manager.get_chat_documents(chat_id)
                chats_info.append({
                    "chat_id": chat_id,
                    "document_count": len(docs_info.get("documents", {})),
                    "total_chunks": docs_info.get("total_chunks", 0)
                })
            except Exception as e:
                chats_info.append({
                    "chat_id": chat_id,
                    "document_count": 0,
                    "total_chunks": 0,
                    "error": str(e)
                })
        
        return {
            "chats": chats_info,
            "total": len(chats_info),
            "current_chat_id": chat_rag_manager.current_chat_id
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list chats: {str(e)}")


@app.delete("/chat/{chat_id}")
def delete_chat(chat_id: str) -> dict:
    """Completely delete a chat and all its associated data (documents, embeddings)"""
    if chat_rag_manager is None:
        raise HTTPException(status_code=500, detail="Chat RAG manager not initialized")
    
    print(f"\n=== DELETING CHAT: {chat_id} ===")
    
    try:
        success = chat_rag_manager.delete_chat_completely(chat_id)
        
        if success:
            print(f"Successfully deleted chat {chat_id} and all its data")
            return {
                "message": f"Chat {chat_id} and all associated data deleted successfully",
                "chat_id": chat_id,
                "deleted": True
            }
        else:
            raise HTTPException(status_code=500, detail=f"Failed to delete chat {chat_id}")
    except Exception as e:
        print(f"Error deleting chat {chat_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete chat: {str(e)}")


@app.get("/debug/documents")
def debug_documents(chat_id: str | None = None) -> dict:
    """Debug endpoint to see what documents are in the current or specified chat context"""
    print("\n=== DEBUG: Chat Documents ===")
    if chat_rag_manager is None:
        return {"error": "Chat RAG manager not initialized"}
    
    try:
        if chat_id:
            # Get documents for specific chat
            info = chat_rag_manager.get_chat_documents(chat_id)
            info["chat_id"] = chat_id
            print(f"Documents for chat {chat_id}: {info}")
        elif chat_rag_manager.current_chat_id:
            # Get documents for current chat
            info = chat_rag_manager.get_current_chat_documents()
            info["chat_id"] = chat_rag_manager.current_chat_id
            print(f"Documents for current chat {chat_rag_manager.current_chat_id}: {info}")
        else:
            # No chat context
            info = {
                "chat_id": None,
                "documents": {},
                "total_chunks": 0,
                "message": "No active chat context"
            }
            print("No active chat context")
        
        print("============================\n")
        return info
    except Exception as e:
        print(f"Error getting documents info: {str(e)}")
        return {"error": str(e)}


@app.delete("/documents/clear")
async def clear_all_documents() -> dict:
    if chat_rag_manager is None:
        raise HTTPException(status_code=500, detail="Chat RAG manager not initialized")
    
    print(f"\n=== CLEAR CHAT DOCUMENTS REQUEST ===")
    try:
        if not chat_rag_manager.current_chat_id:
            raise HTTPException(status_code=400, detail="No active chat context")
        
        print(f"Clearing all documents from chat {chat_rag_manager.current_chat_id}")
        
        success = chat_rag_manager.clear_current_chat_documents()
        
        if success:
            print(f"=== CLEARED CHAT {chat_rag_manager.current_chat_id} DOCUMENTS ===")
            return {
                "message": f"All documents cleared from chat {chat_rag_manager.current_chat_id}",
                "chat_id": chat_rag_manager.current_chat_id
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to clear chat documents")
    except Exception as e:
        print(f"=== CLEAR CHAT ERROR: {str(e)} ===")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/documents/{filename}")
async def delete_document(filename: str, chat_id: str | None = None) -> dict:
    if chat_rag_manager is None:
        raise HTTPException(status_code=500, detail="Chat RAG manager not initialized")
    
    try:
        # Set chat context if provided
        if chat_id:
            chat_rag_manager.set_current_chat(chat_id)
        
        if not chat_rag_manager.current_chat_id:
            raise HTTPException(status_code=400, detail="No active chat context")
        
        # Find the doc_id by filename from vector store metadata
        rag = chat_rag_manager.get_current_rag()
        if not rag:
            raise HTTPException(status_code=500, detail="No RAG pipeline for current chat")
        
        docs_info = rag.get_all_documents_info()
        doc_id_to_delete = None
        
        # Search for the doc_id that matches this filename
        for doc_id, doc_data in docs_info.get("documents", {}).items():
            if doc_data.get("filename") == filename:
                doc_id_to_delete = doc_id
                break
        
        if not doc_id_to_delete:
            raise HTTPException(status_code=404, detail=f"Document '{filename}' not found in vector store")
        
        # Remove document using the actual doc_id
        success = chat_rag_manager.remove_document_from_current_chat(doc_id_to_delete)
        
        if success:
            return {
                "message": f"Document {filename} (doc_id: {doc_id_to_delete}) successfully deleted from chat {chat_rag_manager.current_chat_id}",
                "chat_id": chat_rag_manager.current_chat_id
            }
        else:
            raise HTTPException(status_code=500, detail=f"Failed to remove {filename} from chat context")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/debug/test-retrieval")
def debug_test_retrieval(query: str, chat_id: str | None = None, top_k: int = 3) -> dict:
    """Debug endpoint to test vector retrieval without full RAG"""
    if chat_rag_manager is None:
        raise HTTPException(status_code=500, detail="Chat RAG manager not initialized")
    
    print(f"\n=== DEBUG: TESTING RETRIEVAL ===")
    print(f"Query: {query}")
    print(f"Chat ID: {chat_id}")
    print(f"Top K: {top_k}")
    
    try:
        # Set chat context if provided
        if chat_id:
            chat_rag_manager.set_current_chat(chat_id)
        
        if not chat_rag_manager.current_chat_id:
            raise HTTPException(status_code=400, detail="No active chat context")
        
        rag = chat_rag_manager.get_current_rag()
        if not rag:
            raise HTTPException(status_code=500, detail="No RAG instance for current chat")
        
        # Test retrieval only
        contexts = rag.retrieve(query, top_k)
        
        print(f"Retrieved {len(contexts)} contexts")
        for i, context in enumerate(contexts):
            print(f"  Context {i+1}: score={context.score:.4f}, text_preview='{context.text[:100]}...'")
        
        print("================================\n")
        
        return {
            "query": query,
            "chat_id": chat_rag_manager.current_chat_id,
            "num_contexts": len(contexts),
            "contexts": [
                {
                    "score": c.score,
                    "text_preview": c.text[:200] + "..." if len(c.text) > 200 else c.text,
                    "full_text": c.text
                }
                for c in contexts
            ]
        }
    except Exception as e:
        print(f"Debug retrieval error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Debug retrieval failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, timeout_keep_alive=500)

#this will be FastAPI/Flask entrypoint