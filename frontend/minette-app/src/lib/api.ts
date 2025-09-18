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
  const res = await fetch(`${BASE_URL}/documents/clear`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Clear all failed (${res.status}): ${text}`);
  }
  return res.json();
}


