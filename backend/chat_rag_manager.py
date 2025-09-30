"""
Chat-specific RAG Manager
Manages separate document contexts and vector stores per chat session
"""

import os
import shutil
from typing import Dict, List, Optional
from rag_pipeline import RAGPipeline, RetrievedContext


class ChatRAGManager:
    """
    Manages separate RAG instances per chat ID
    Each chat gets its own ChromaDB collection and document folder
    """
    
    def __init__(self, base_persist_dir: str, base_docs_dir: str):
        self.base_persist_dir = base_persist_dir
        self.base_docs_dir = base_docs_dir
        self.rag_instances: Dict[str, RAGPipeline] = {}
        self.current_chat_id: Optional[str] = None
        
        # Ensure base directories exist
        os.makedirs(base_persist_dir, exist_ok=True)
        os.makedirs(base_docs_dir, exist_ok=True)
    
    def get_chat_persist_dir(self, chat_id: str) -> str:
        """Get the ChromaDB persist directory for a specific chat"""
        return os.path.join(self.base_persist_dir, f"chat_{chat_id}")
    
    def get_chat_docs_dir(self, chat_id: str) -> str:
        """Get the documents directory for a specific chat"""
        return os.path.join(self.base_docs_dir, f"chat_{chat_id}")
    
    def get_rag_for_chat(self, chat_id: str) -> RAGPipeline:
        """Get or create RAG instance for specific chat"""
        if chat_id not in self.rag_instances:
            chat_persist_dir = self.get_chat_persist_dir(chat_id)
            collection_name = f"chat_{chat_id}_docs"
            
            os.makedirs(chat_persist_dir, exist_ok=True)
            
            self.rag_instances[chat_id] = RAGPipeline(
                persist_directory=chat_persist_dir,
                collection_name=collection_name
            )
            print(f"Created new RAG instance for chat {chat_id}")
        
        return self.rag_instances[chat_id]
    
    def set_current_chat(self, chat_id: str) -> RAGPipeline:
        """Switch to a specific chat context"""
        self.current_chat_id = chat_id
        rag = self.get_rag_for_chat(chat_id)
        print(f"Switched to chat context: {chat_id}")
        return rag
    
    def get_current_rag(self) -> Optional[RAGPipeline]:
        """Get RAG instance for current chat, or None if no chat is active"""
        if self.current_chat_id:
            return self.get_rag_for_chat(self.current_chat_id)
        return None
    
    def clear_current_chat(self):
        """Clear the current chat context (no active chat)"""
        print(f"Clearing current chat context (was: {self.current_chat_id})")
        # Clear current chat context but don't delete the chat's documents
        # This allows creating a fresh new chat context
        self.current_chat_id = None
    
    def ingest_document_to_current_chat(self, doc_id: str, text: str, filename: str) -> int:
        """Ingest document to current chat's RAG context"""
        if not self.current_chat_id:
            raise ValueError("No active chat context. Set current chat first.")
        
        rag = self.get_current_rag()
        metadata = {"filename": filename, "chat_id": self.current_chat_id}
        return rag.ingest_document(doc_id, text, metadata)
    
    def save_file_to_current_chat(self, filename: str, content: bytes) -> str:
        """Save uploaded file to current chat's document folder"""
        if not self.current_chat_id:
            raise ValueError("No active chat context. Set current chat first.")
        
        chat_docs_dir = self.get_chat_docs_dir(self.current_chat_id)
        os.makedirs(chat_docs_dir, exist_ok=True)
        
        file_path = os.path.join(chat_docs_dir, filename)
        with open(file_path, "wb") as f:
            f.write(content)
        
        print(f"Saved file {filename} to chat {self.current_chat_id} folder")
        return file_path
    
    def get_chat_documents(self, chat_id: str) -> Dict:
        """Get information about documents in a specific chat"""
        rag = self.get_rag_for_chat(chat_id)
        return rag.get_all_documents_info()
    
    def get_current_chat_documents(self) -> Dict:
        """Get information about documents in current chat"""
        if not self.current_chat_id:
            return {"documents": {}, "total_chunks": 0}
        
        rag = self.get_current_rag()
        return rag.get_all_documents_info() if rag else {"documents": {}, "total_chunks": 0}
    
    def remove_document_from_current_chat(self, doc_id: str) -> bool:
        """Remove document from current chat's context"""
        if not self.current_chat_id:
            return False
        
        rag = self.get_current_rag()
        if not rag:
            return False
        
        # Remove from RAG
        success = rag.remove_document(doc_id)
        
        # Remove file from chat folder
        try:
            chat_docs_dir = self.get_chat_docs_dir(self.current_chat_id)
            potential_files = [
                f"{doc_id}.pdf",
                f"{doc_id}",
            ]
            
            for filename in os.listdir(chat_docs_dir):
                if filename.startswith(doc_id):
                    file_path = os.path.join(chat_docs_dir, filename)
                    os.remove(file_path)
                    print(f"Removed file: {file_path}")
                    
        except Exception as e:
            print(f"Error removing file for doc {doc_id}: {e}")
        
        return success
    
    def clear_current_chat_documents(self) -> bool:
        """Clear all documents from current chat"""
        if not self.current_chat_id:
            return False
        
        rag = self.get_current_rag()
        if not rag:
            return False
        
        # Clear RAG context
        success = rag.clear_all_documents()
        
        # Clear chat documents folder
        try:
            chat_docs_dir = self.get_chat_docs_dir(self.current_chat_id)
            if os.path.exists(chat_docs_dir):
                shutil.rmtree(chat_docs_dir)
                print(f"Cleared documents folder for chat {self.current_chat_id}")
        except Exception as e:
            print(f"Error clearing chat documents folder: {e}")
        
        return success
    
    def query_current_chat(self, query: str, k: int = 5):
        """Query documents in current chat context"""
        if not self.current_chat_id:
            raise ValueError("No active chat context")
        
        rag = self.get_current_rag()
        if not rag:
            raise ValueError("No RAG instance for current chat")
        
        return rag.retrieve(query, k)
    
    def rag_answer_stream_current_chat(self, query: str, k: int = 5):
        """Stream RAG answer from current chat context"""
        if not self.current_chat_id:
            raise ValueError("No active chat context")
        
        rag = self.get_current_rag()
        if not rag:
            raise ValueError("No RAG instance for current chat")
        
        return rag.rag_answer_stream(query, k)
    
    def delete_chat_completely(self, chat_id: str) -> bool:
        """Completely delete a chat and all its data"""
        try:
            # Remove from memory
            if chat_id in self.rag_instances:
                del self.rag_instances[chat_id]
            
            # Clear current chat if this was it
            if self.current_chat_id == chat_id:
                self.current_chat_id = None
            
            # Delete chat's ChromaDB data
            chat_persist_dir = self.get_chat_persist_dir(chat_id)
            if os.path.exists(chat_persist_dir):
                shutil.rmtree(chat_persist_dir)
                print(f"Deleted ChromaDB data for chat {chat_id}")
            
            # Delete chat's documents folder
            chat_docs_dir = self.get_chat_docs_dir(chat_id)
            if os.path.exists(chat_docs_dir):
                shutil.rmtree(chat_docs_dir)
                print(f"Deleted documents folder for chat {chat_id}")
            
            return True
        except Exception as e:
            print(f"Error deleting chat {chat_id}: {e}")
            return False
    
    def list_all_chats(self) -> List[str]:
        """List all chat IDs that have data"""
        chats = []
        
        # Check persist directories
        if os.path.exists(self.base_persist_dir):
            for item in os.listdir(self.base_persist_dir):
                if item.startswith("chat_") and os.path.isdir(os.path.join(self.base_persist_dir, item)):
                    chat_id = item[5:]  # Remove "chat_" prefix
                    chats.append(chat_id)
        
        return sorted(list(set(chats)))