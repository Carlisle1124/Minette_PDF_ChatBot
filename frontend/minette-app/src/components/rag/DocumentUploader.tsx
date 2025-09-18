import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Trash2 } from "lucide-react";
import { uploadPdf, deleteDocument, clearAllDocuments } from "@/lib/api";

interface UploadedDoc {
  name: string;
  chunks: number;
}

interface DocumentUploaderProps {
  onDocumentDeleted?: () => void;
  onNotification?: (
    title: string,
    message: string,
    type?: "info" | "success" | "warning" | "error"
  ) => void;
}

export const DocumentUploader = ({
  onDocumentDeleted,
  onNotification,
}: DocumentUploaderProps) => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const onFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);

    try {
      // Clear frontend state - backend will auto-clear vector store
      setDocs([]);

      for (const file of Array.from(files)) {
        setStatus(`Uploading ${file.name}...`);
        const result = await uploadPdf(file);
        const doc: UploadedDoc = {
          name: result.filename ?? file.name,
          chunks: result.chunks,
        };
        setDocs((d) => [...d, doc]);
        toast.success(`Indexed ${doc.name} (${doc.chunks} chunks)`);

        if (onNotification) {
          onNotification(
            "Document uploaded",
            `Successfully indexed ${doc.name} with ${doc.chunks} chunks`,
            "success"
          );
        }
      }

      // Auto-clear chat when new documents are uploaded
      if (onDocumentDeleted) {
        onDocumentDeleted();
      }
    } catch (e: any) {
      console.error(e);
      const errorMessage =
        "Failed to upload PDFs: " + (e.message ?? e.toString());
      toast.error(errorMessage);

      if (onNotification) {
        onNotification("Upload failed", errorMessage, "error");
      }
    } finally {
      setLoading(false);
      setStatus(null);
    }
  };

  const removeDoc = async (name: string) => {
    setDeleting(name);
    try {
      await deleteDocument(name);
      setDocs((d) => d.filter((doc) => doc.name !== name));
      toast.success(`Removed ${name}`);

      if (onNotification) {
        onNotification(
          "Document deleted",
          `Successfully removed ${name} from the system`,
          "info"
        );
      }

      // Reset the chat when a document is deleted
      if (onDocumentDeleted) {
        onDocumentDeleted();
      }
    } catch (e: any) {
      console.error(e);
      const errorMessage =
        "Failed to delete document: " + (e.message ?? e.toString());
      toast.error(errorMessage);

      if (onNotification) {
        onNotification("Delete failed", errorMessage, "error");
      }
    } finally {
      setDeleting(null);
    }
  };

  const clearAllDocs = async (showNotification: boolean = true) => {
    setClearingAll(true);
    try {
      await clearAllDocuments();
      setDocs([]);
      toast.success("All documents cleared");

      if (showNotification && onNotification) {
        onNotification(
          "Documents cleared",
          "All documents have been removed from the system",
          "info"
        );
      }

      // Reset the chat when documents are cleared
      if (onDocumentDeleted) {
        onDocumentDeleted();
      }
    } catch (e: any) {
      console.error(e);
      const errorMessage =
        "Failed to clear documents: " + (e.message ?? e.toString());
      toast.error(errorMessage);

      if (showNotification && onNotification) {
        onNotification("Clear failed", errorMessage, "error");
      }
    } finally {
      setClearingAll(false);
    }
  };

  return (
    <Card className="border-muted/50">
      <CardHeader>
        <CardTitle>Manage PDFs</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          New uploads automatically clear existing documents to ensure fresh
          context.
        </p>
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
          <>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium">Uploaded Documents:</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => clearAllDocs()}
                disabled={clearingAll || loading}
                className="text-destructive hover:text-destructive"
              >
                {clearingAll ? "Clearing..." : "Clear All"}
              </Button>
            </div>
            <ul className="space-y-2">
              {docs.map(({ name, chunks }) => (
                <li
                  key={name}
                  className="flex items-center justify-between rounded-md border p-2"
                >
                  <div className="truncate pr-2">
                    <span className="font-medium">{name}</span>
                    <span className="text-muted-foreground text-sm ml-2">
                      {chunks} chunks
                    </span>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => removeDoc(name)}
                    disabled={deleting === name || loading || clearingAll}
                  >
                    <Trash2 className="h-4 w-4" />
                    {deleting === name && <span className="ml-1">...</span>}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
};
