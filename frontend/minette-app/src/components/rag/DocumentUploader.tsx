import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Trash2 } from "lucide-react";
import { uploadPdf, PdfChunk, chatWithPdf } from "@/lib/api";

interface UploadedDoc {
  name: string;
  summary: string;
  chunks: PdfChunk[];
}

interface DocumentUploaderProps {
  onChunksUpdate?: (chunks: PdfChunk[]) => void;
}

export const DocumentUploader = ({ onChunksUpdate }: DocumentUploaderProps) => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [docs, setDocs] = useState<UploadedDoc[]>([]);

  const onFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);

    try {
      for (const file of Array.from(files)) {
        setStatus(`Uploading ${file.name}...`);
        const result = await uploadPdf(file);
        const doc = { name: file.name, summary: result.summary, chunks: result.chunks };
        setDocs((d) => [...d, doc]);
        toast.success(`Uploaded ${file.name}`);

        // Notify parent component (Chat) about new chunks
        if (onChunksUpdate) onChunksUpdate(result.chunks);
      }
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to upload PDFs: " + (e.message ?? e.toString()));
    } finally {
      setLoading(false);
      setStatus(null);
    }
  };

  const removeDoc = (name: string) => {
    setDocs((d) => d.filter((doc) => doc.name !== name));
    toast.success(`Removed ${name}`);
    // Update parent
    const remainingChunks = docs.filter((doc) => doc.name !== name).flatMap((d) => d.chunks);
    if (onChunksUpdate) onChunksUpdate(remainingChunks);
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
            disabled={loading}
          />
          <Button variant="secondary" disabled>
            {loading ? status ?? "Processing..." : "Choose files"}
          </Button>
        </div>

        <Separator />

        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No PDFs uploaded yet.</p>
        ) : (
          <ul className="space-y-2">
            {docs.map(({ name, summary }) => (
              <li key={name} className="flex items-center justify-between rounded-md border p-2">
                <div className="truncate pr-2">
                  <span className="font-medium">{name}</span>
                  <span className="text-muted-foreground text-sm ml-2">
                    {summary.slice(0, 60)}...
                  </span>
                </div>
                <Button variant="destructive" size="sm" onClick={() => removeDoc(name)}>
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
