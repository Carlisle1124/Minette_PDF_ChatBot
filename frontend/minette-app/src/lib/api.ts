export interface ChatResponseContext {
  text: string;
  score: number;
}

export interface ChatResponse {
  answer: string;
  contexts: ChatResponseContext[];
}

const BASE_URL = (import.meta as any).env?.VITE_BACKEND_URL ?? "http://localhost:8000";

export async function uploadPdf(file: File, chatId?: string): Promise<{ filename: string; chunks: number }>{
  const form = new FormData();
  form.append("file", file);
  
  // Build URL with optional chat_id and replace parameters
  const url = chatId
    ? `${BASE_URL}/ingest/pdf?chat_id=${encodeURIComponent(chatId)}&replace=true`
    : `${BASE_URL}/ingest/pdf?replace=true`;

  const res = await fetch(url, {
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
  
  // Build URL with chat_id as query parameter
  const url = chatId 
    ? `${BASE_URL}/ingest/pdf/add?chat_id=${encodeURIComponent(chatId)}`
    : `${BASE_URL}/ingest/pdf/add`;

  const res = await fetch(url, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Add PDF failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function chat(question: string, chatId?: string, topK?: number, maxTokens?: number, model?: string): Promise<ChatResponse> {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      message: question, 
      chat_id: chatId,
      top_k: topK,
      max_tokens: maxTokens,
      model: model || undefined,
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

export async function* chatStream(question: string, chatId?: string, topK?: number, maxTokens?: number, model?: string): AsyncGenerator<StreamChunk, void, undefined> {
  const res = await fetch(`${BASE_URL}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      message: question, 
      chat_id: chatId,
      top_k: topK,
      max_tokens: maxTokens,
      model: model || undefined,
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

// ============================================
// Model Download Management API (v2)
// ============================================

// --- Types ---

export interface ModelInfo {
  model_id: string;
  repo_id: string;
  filename: string;
  local_path: string | null;
  size_bytes: number | null;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  error?: string | null;
}

export interface ModelSearchResult {
  model_id: string;
  downloads: number;
  likes: number;
  tags: string[];
  pipeline_tag: string | null;
  library_name: string | null;
}

export interface OnlineModel {
  id: string;
  name: string;
  source: "ollama" | "huggingface";
  size_label: string;
  description: string;
  tags: string[];
  downloads: number;
  likes: number;
  repo_id: string | null;
  filename: string | null;
  download_url: string | null;
  sha256: string | null;
  installed: boolean;
}

export interface LocalModel {
  id: string;
  name: string;
  source: "ollama" | "huggingface";
  size_bytes: number;
  size_label: string;
  local_path: string | null;
  family: string;
  quantization: string;
  tags: string[];
  available?: boolean;
}

export interface DownloadProgress {
  task_id: string;
  state: "queued" | "downloading" | "verifying" | "completed" | "failed" | "cancelled";
  progress_percent: number;
  downloaded_bytes: number;
  total_bytes: number;
  speed_bps: number;
  eta_seconds: number;
  error: string | null;
  attempt: number;
  max_retries: number;
  filename: string;
  model_id: string;
  source: string;
}

export interface DownloadRequest {
  source: "ollama" | "huggingface";
  model_name?: string;      // For Ollama
  repo_id?: string;         // For HuggingFace
  filename?: string;        // For HuggingFace
  model_id?: string;        // Custom ID (optional)
}

export interface RepoFileInfo {
  filename: string;
  size: number | null;
  size_label: string;
  download_url: string;
  sha256?: string;
}

// --- Core 4 Endpoints ---

/** GET /models/online — registry/catalog models available for download */
export async function getOnlineModels(
  query?: string,
  source?: string,
  limit: number = 20
): Promise<{ models: OnlineModel[]; total: number }> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (source) params.set("source", source);
  params.set("limit", limit.toString());
  const qs = params.toString();
  const res = await fetch(`${BASE_URL}/models/online${qs ? `?${qs}` : ""}`);
  if (!res.ok) { const t = await res.text(); throw new Error(`Online models failed (${res.status}): ${t}`); }
  return res.json();
}

/** GET /models/local — installed models (Ollama + HuggingFace) */
export async function getLocalModels(): Promise<{ models: LocalModel[]; total: number }> {
  const res = await fetch(`${BASE_URL}/models/local`);
  if (!res.ok) { const t = await res.text(); throw new Error(`Local models failed (${res.status}): ${t}`); }
  return res.json();
}

/** POST /models/download — start background download */
export async function startModelDownload(req: DownloadRequest): Promise<{
  task_id: string;
  model_id: string;
  source: string;
}> {
  const res = await fetch(`${BASE_URL}/models/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Start download failed (${res.status}): ${t}`); }
  return res.json();
}

/** GET /models/progress/:id — download progress (polling) */
export async function getDownloadProgress(taskId: string): Promise<DownloadProgress> {
  const res = await fetch(`${BASE_URL}/models/progress/${encodeURIComponent(taskId)}`);
  if (!res.ok) { const t = await res.text(); throw new Error(`Progress failed (${res.status}): ${t}`); }
  return res.json();
}

// --- Supporting Endpoints ---

/** POST /models/cancel/:id */
export async function cancelDownload(taskId: string): Promise<{ message: string; task_id: string }> {
  const res = await fetch(`${BASE_URL}/models/cancel/${encodeURIComponent(taskId)}`, { method: "POST" });
  if (!res.ok) { const t = await res.text(); throw new Error(`Cancel failed (${res.status}): ${t}`); }
  return res.json();
}

/** GET /models/queue — all downloads with status */
export async function getDownloadQueue(): Promise<{ downloads: DownloadProgress[]; total: number }> {
  const res = await fetch(`${BASE_URL}/models/queue`);
  if (!res.ok) { const t = await res.text(); throw new Error(`Queue failed (${res.status}): ${t}`); }
  return res.json();
}

/** SSE stream for real-time download progress */
export function streamDownloadProgress(
  taskId: string,
  onProgress: (p: DownloadProgress) => void,
  onDone: () => void,
  onError: (err: string) => void,
): () => void {
  const url = `${BASE_URL}/models/progress/${encodeURIComponent(taskId)}/stream`;
  const evtSource = new EventSource(url);

  evtSource.onmessage = (evt) => {
    try {
      const data: DownloadProgress = JSON.parse(evt.data);
      if ("error" in data && (data as any).error === "task not found") {
        onError("Task not found");
        evtSource.close();
        return;
      }
      onProgress(data);
      if (["completed", "failed", "cancelled"].includes(data.state)) {
        onDone();
        evtSource.close();
      }
    } catch { /* ignore parse errors */ }
  };

  evtSource.onerror = () => {
    onError("SSE connection lost");
    evtSource.close();
  };

  // Return a cleanup function
  return () => evtSource.close();
}

// --- Legacy endpoints (backward compat) ---

export async function listModels(): Promise<{ models: ModelInfo[]; total: number }> {
  const res = await fetch(`${BASE_URL}/models`);
  if (!res.ok) { const t = await res.text(); throw new Error(`List models failed (${res.status}): ${t}`); }
  return res.json();
}

export async function getModel(modelId: string): Promise<ModelInfo> {
  const res = await fetch(`${BASE_URL}/models/${encodeURIComponent(modelId)}`);
  if (!res.ok) { const t = await res.text(); throw new Error(`Get model failed (${res.status}): ${t}`); }
  return res.json();
}

export async function downloadModel(
  repoId: string,
  filename: string,
  modelId?: string,
): Promise<{ task_id: string; model_id: string; source: string }> {
  // Redirect to new v2 endpoint
  return startModelDownload({ source: "huggingface", repo_id: repoId, filename, model_id: modelId });
}

export async function deleteModel(modelId: string): Promise<{ message: string; model_id: string; deleted: boolean }> {
  const res = await fetch(`${BASE_URL}/models/${encodeURIComponent(modelId)}`, { method: "DELETE" });
  if (!res.ok) { const t = await res.text(); throw new Error(`Delete model failed (${res.status}): ${t}`); }
  return res.json();
}

export async function getModelStatus(modelId: string): Promise<{
  model_id: string;
  progress: number;
  downloaded_bytes: number;
  total_bytes: number;
  status: string;
  error: string | null;
}> {
  const res = await fetch(`${BASE_URL}/models/${encodeURIComponent(modelId)}/status`);
  if (!res.ok) { const t = await res.text(); throw new Error(`Model status failed (${res.status}): ${t}`); }
  return res.json();
}

export async function searchModels(
  query: string,
  limit: number = 10,
  task?: string,
): Promise<{ query: string; results: ModelSearchResult[]; total: number }> {
  const res = await fetch(`${BASE_URL}/models/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit, task }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Search models failed (${res.status}): ${t}`); }
  return res.json();
}

export async function listRepoFiles(repoId: string): Promise<{
  repo_id: string;
  files: RepoFileInfo[];
  total: number;
}> {
  const res = await fetch(`${BASE_URL}/models/repo/${encodeURIComponent(repoId)}/files`);
  if (!res.ok) { const t = await res.text(); throw new Error(`List repo files failed (${res.status}): ${t}`); }
  return res.json();
}

// ============================================
// Active Model & Pulled Models
// ============================================

/** GET /models/active — get the currently active chat model */
export async function getActiveModel(): Promise<{ model: string }> {
  const res = await fetch(`${BASE_URL}/models/active`);
  if (!res.ok) { const t = await res.text(); throw new Error(`Get active model failed (${res.status}): ${t}`); }
  return res.json();
}

/** POST /models/active — set the active chat model */
export async function setActiveModel(modelId: string): Promise<{ model: string; message: string }> {
  const res = await fetch(`${BASE_URL}/models/active`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: modelId }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Set active model failed (${res.status}): ${t}`); }
  return res.json();
}

/** GET /models/pulled — quick check which Ollama models are pulled */
export interface PulledModel {
  name: string;
  size: number;
  modified_at: string;
}

export async function getPulledModels(): Promise<{ models: PulledModel[]; error?: string }> {
  const res = await fetch(`${BASE_URL}/models/pulled`);
  if (!res.ok) { const t = await res.text(); throw new Error(`Get pulled models failed (${res.status}): ${t}`); }
  return res.json();
}
