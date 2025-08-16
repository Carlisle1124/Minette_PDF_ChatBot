import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { extractTextFromPdf } from "@/lib/pdf";
import { chunkText } from "@/lib/chunk";
import { embedTexts } from "@/lib/embeddings";
import { vectorStore } from "@/lib/vectorstore";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Trash2 } from "lucide-react";

export const DocumentUploader = () => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // trigger re-render after add/remove

  const sources = useMemo(() => vectorStore.countsBySource(), [version]);

  const onFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    try {
      let totalChunks = 0;
      for (const file of Array.from(files)) {
        setStatus(`Reading ${file.name}...`);
        const { text } = await extractTextFromPdf(file);
        const chunks = chunkText(text);
        totalChunks += chunks.length;
        setStatus(`Embedding ${chunks.length} chunks from ${file.name}...`);
        const vectors = await embedTexts(chunks);
        vectorStore.add(
          vectors.map((embedding, i) => ({
            text: chunks[i],
            metadata: { source: file.name },
            embedding,
          }))
        );
      }
      toast.success(`Added ${totalChunks} chunks. Ready to chat!`);
      setVersion((v) => v + 1);
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to process PDFs");
    } finally {
      setLoading(false);
      setStatus(null);
    }
  };

  const removeSource = (source: string) => {
    vectorStore.removeBySource(source);
    toast.success(`Removed ${source}`);
    setVersion((v) => v + 1);
  };

  return (
    <Card className="border-muted/50">
      <CardHeader>
        <CardTitle>Manage PDFs</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            type="file"
            accept="application/pdf"
            multiple
            onChange={(e) => onFilesSelected(e.target.files)}
            aria-label="Upload PDF files"
            className="block text-sm"
            disabled={loading}
          />
          <Button variant="secondary" disabled>
            {loading ? status ?? "Processing..." : "Choose files"}
          </Button>
          <div className="text-sm text-muted-foreground sm:ml-auto">
            {vectorStore.size} chunks indexed
          </div>
        </div>

        <Separator />

        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">No PDFs uploaded yet.</p>
        ) : (
          <ul className="space-y-2">
            {sources.map(({ source, count }) => (
              <li key={source} className="flex items-center justify-between rounded-md border p-2">
                <div className="truncate pr-2">
                  <span className="font-medium">{source}</span>
                  <span className="text-muted-foreground text-sm ml-2">{count} chunks</span>
                </div>
                <Button variant="destructive" size="sm" onClick={() => removeSource(source)} aria-label={`Delete ${source}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};
