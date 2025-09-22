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

export async function addPdf(file: File): Promise<{ filename: string; chunks: number }>{
  const form = new FormData();
  form.append("file", file);

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

export async function chat(question: string, topK?: number): Promise<ChatResponse> {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: question, top_k: topK }),
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

export async function* chatStream(question: string, topK?: number, filterDocuments?: string[]): AsyncGenerator<StreamChunk, void, undefined> {
  const res = await fetch(`${BASE_URL}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      message: question, 
      top_k: topK,
      filter_documents: filterDocuments 
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

export async function deleteDocument(filename: string): Promise<{ message: string }> {
  const res = await fetch(`${BASE_URL}/documents/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function clearAllDocuments(): Promise<{ message: string }> {
  console.log("API: clearAllDocuments called, BASE_URL:", BASE_URL);
  const res = await fetch(`${BASE_URL}/documents/clear`, {
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

