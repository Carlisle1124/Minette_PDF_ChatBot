export interface ChatResponseContext {
  text: string;
  score: number;
}

export interface ChatResponse {
  answer: string;
  contexts: ChatResponseContext[];
}

const BASE_URL = (import.meta as any).env?.VITE_BACKEND_URL ?? "http://localhost:8000";

export async function uploadPdf(file: File): Promise<{ filename: string; chunks: number }>{
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE_URL}/ingest/pdf`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function addPdf(file: File, chatId?: string): Promise<{ filename: string; chunks: number; chat_id: string; doc_id: string }>{
  const form = new FormData();
  form.append("file", file);
  if (chatId) {
    form.append("chat_id", chatId);
  }

  const res = await fetch(`${BASE_URL}/ingest/pdf/add`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Add PDF failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function chat(question: string, chatId?: string, topK?: number): Promise<ChatResponse> {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      message: question, 
      chat_id: chatId,
      top_k: topK 
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chat failed (${res.status}): ${text}`);
  }
  return res.json();
}

export interface StreamChunk {
  type: 'contexts' | 'content' | 'done' | 'error';
  data: any;
}

export async function* chatStream(question: string, chatId?: string, topK?: number): AsyncGenerator<StreamChunk, void, undefined> {
  const res = await fetch(`${BASE_URL}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      message: question, 
      chat_id: chatId,
      top_k: topK
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chat stream failed (${res.status}): ${text}`);
  }

  if (!res.body) {
    throw new Error("No response body for streaming");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      
      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            yield data as StreamChunk;
            
            if (data.type === 'done' || data.type === 'error') {
              return;
            }
          } catch (e) {
            console.warn('Failed to parse SSE data:', line);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function deleteDocument(filename: string, chatId?: string): Promise<{ message: string }> {
  const url = chatId 
    ? `${BASE_URL}/documents/${encodeURIComponent(filename)}?chat_id=${chatId}`
    : `${BASE_URL}/documents/${encodeURIComponent(filename)}`;
  const res = await fetch(url, {
    method: "DELETE",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function clearAllDocuments(chatId?: string): Promise<{ message: string; chat_id: string }> {
  console.log("API: clearAllDocuments called, chatId:", chatId, "BASE_URL:", BASE_URL);
  const url = chatId ? `${BASE_URL}/documents/clear?chat_id=${chatId}` : `${BASE_URL}/documents/clear`;
  const res = await fetch(url, {
    method: "DELETE",
  });
  console.log("API: fetch response status:", res.status);
  if (!res.ok) {
    const text = await res.text();
    console.error("API: fetch failed with text:", text);
    throw new Error(`Clear all failed (${res.status}): ${text}`);
  }
  const result = await res.json();
  console.log("API: clearAllDocuments success result:", result);
  return result;
}

// New chat management functions
export async function switchChat(chatId: string): Promise<{ message: string; chat_id: string; documents: any; total_chunks: number }> {
  const res = await fetch(`${BASE_URL}/chat/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Switch chat failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function newChat(): Promise<{ message: string }> {
  const res = await fetch(`${BASE_URL}/chat/new`, {
    method: "POST",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`New chat failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getCurrentChat(): Promise<{ chat_id: string | null; has_context: boolean; documents: any; total_chunks: number }> {
  const res = await fetch(`${BASE_URL}/chat/current`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get current chat failed (${res.status}): ${text}`);
  }
  return res.json();
}

export interface DocumentInfo {
  filename: string;
  chunk_count: number;
  chunk_ids: string[];
}

export interface DocumentsResponse {
  total_chunks: number;
  documents: Record<string, DocumentInfo>;
}

export async function fetchDocuments(): Promise<DocumentsResponse> {
  console.log("API: fetchDocuments called, BASE_URL:", BASE_URL);
  const res = await fetch(`${BASE_URL}/debug/documents`);
  console.log("API: fetchDocuments response status:", res.status);
  if (!res.ok) {
    const text = await res.text();
    console.error("API: fetchDocuments failed with text:", text);
    throw new Error(`Fetch documents failed (${res.status}): ${text}`);
  }
  const result = await res.json();
  console.log("API: fetchDocuments success result:", result);
  return result;
}

// Load specific documents for a chat (re-upload them to the vector store)
export async function loadDocumentsForChat(filenames: string[]): Promise<{ loaded: string[]; failed: string[] }> {
  const results = {
    loaded: [] as string[],
    failed: [] as string[]
  };

  // Note: This assumes you have the actual files stored somewhere accessible
  // In a real implementation, you might need to store the file blobs or have a backend endpoint
  // that can reload documents by filename. For now, this is a placeholder.
  
  console.log("API: loadDocumentsForChat called for files:", filenames);
  
  // This is a simplified implementation - in practice, you'd need to either:
  // 1. Store the actual file data along with the chat
  // 2. Have a backend endpoint that can re-load documents by filename
  // 3. Implement a more sophisticated document management system
  
  return results;
}

// Check if backend has specific documents loaded
export async function checkDocumentsLoaded(filenames: string[]): Promise<{ [filename: string]: boolean }> {
  try {
    const docs = await fetchDocuments();
    const result: { [filename: string]: boolean } = {};
    
    filenames.forEach(filename => {
      result[filename] = filename in docs.documents;
    });
    
    return result;
  } catch (error) {
    console.error("Error checking loaded documents:", error);
    return {};
  }
}

// Create a new chat context in the backend
export async function createNewBackendChat(): Promise<{ message: string }> {
  const res = await fetch(`${BASE_URL}/chat/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create new chat failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Switch to a specific chat context in the backend
export async function switchBackendChat(chatId: string): Promise<{ message: string; chat_id: string; documents: any; total_chunks: number }> {
  const res = await fetch(`${BASE_URL}/chat/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Switch chat failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Get current backend chat context
export async function getCurrentBackendChat(): Promise<{ chat_id: string | null; has_context: boolean; documents: any; total_chunks: number }> {
  const res = await fetch(`${BASE_URL}/chat/current`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get current chat failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Debug function to test vector retrieval
export async function debugTestRetrieval(query: string, chatId?: string, topK: number = 3): Promise<{ query: string; chat_id: string; num_contexts: number; contexts: any[] }> {
  const res = await fetch(`${BASE_URL}/debug/test-retrieval`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      query, 
      chat_id: chatId,
      top_k: topK 
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Debug test retrieval failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Delete a chat completely from the backend (documents + embeddings)
export async function deleteChatFromBackend(chatId: string): Promise<{ message: string; chat_id: string; deleted: boolean }> {
  const res = await fetch(`${BASE_URL}/chat/${encodeURIComponent(chatId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete chat failed (${res.status}): ${text}`);
  }
  return res.json();
}

// List all chats from backend with their metadata
export interface BackendChatInfo {
  chat_id: string;
  document_count: number;
  total_chunks: number;
  error?: string;
}

export async function listBackendChats(): Promise<{ chats: BackendChatInfo[]; total: number; current_chat_id: string | null }> {
  const res = await fetch(`${BASE_URL}/chats`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`List chats failed (${res.status}): ${text}`);
  }
  return res.json();
}

