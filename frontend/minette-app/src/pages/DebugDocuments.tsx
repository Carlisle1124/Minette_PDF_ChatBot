import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL ?? "http://localhost:8000";

interface ChunkInfo {
  filename: string;
  chunk_count: number;
  chunk_ids: string[];
}

interface DebugDocumentsInfo {
  total_chunks: number;
  documents: Record<string, ChunkInfo>;
}

export default function DebugDocumentsPage() {
  const [info, setInfo] = useState<DebugDocumentsInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${BACKEND_URL}/debug/documents`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setInfo(data);
        setError(null);
      })
      .catch((e) => {
        setError(e.message);
        setInfo(null);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="container py-10">
      <Card>
        <CardHeader>
          <CardTitle>Debug: Vector Store Chunks</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p>Loading...</p>}
          {error && <p className="text-destructive">Error: {error}</p>}
          {info && (
            <>
              <p>
                Total Chunks: <b>{info.total_chunks}</b>
              </p>
              <ul className="mt-4 space-y-4">
                {Object.entries(info.documents).map(([docId, doc]) => (
                  <li key={docId} className="border rounded p-3">
                    <div>
                      <b>Document ID:</b> {docId}
                    </div>
                    <div>
                      <b>Filename:</b> {doc.filename}
                    </div>
                    <div>
                      <b>Chunk Count:</b> {doc.chunk_count}
                    </div>
                    <details>
                      <summary>Chunk IDs</summary>
                      <ul className="text-xs mt-2">
                        {doc.chunk_ids.map((id) => (
                          <li key={id}>{id}</li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
