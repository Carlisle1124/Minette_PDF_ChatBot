// src/lib/api.ts

export interface PdfChunk {
  text: string;
}

export async function uploadPdf(file: File) {
  const formData = new FormData();
  formData.append("pdf", file);

  const res = await fetch("http://localhost:5000/api/upload", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) throw new Error("Failed to upload PDF");

  return await res.json() as { summary: string; chunks: PdfChunk[] };
}

export async function chatWithPdf(query: string, contexts?: PdfChunk[]) {
  const res = await fetch("http://localhost:5000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, contexts }),
  });

  if (!res.ok) throw new Error("Chat request failed");

  return await res.json() as { answer: string };
}
