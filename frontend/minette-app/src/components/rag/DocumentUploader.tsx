import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  uploadPdf,
  deleteDocument,
  clearAllDocuments,
  addPdf,
  fetchDocuments,
  createNewBackendChat,
  switchBackendChat,
} from "@/lib/api";
import { ChatStorageManager } from "@/lib/chatStorage";

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
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);

  const onFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);

    try {
      // Process each file without clearing existing documents
      for (const file of Array.from(files)) {
        setStatus(`Adding ${file.name}...`);
        // Get current chat ID for the upload
        const currentChatId = ChatStorageManager.getCurrentChatId();
        let chatId = currentChatId;

        // If no current chat, create a new one in frontend
        if (!chatId) {
          const title = `Chat ${new Date().toLocaleDateString()}`;
          const newChat = ChatStorageManager.createNewChat(title);
          chatId = newChat.id;
        }

        // Always ensure backend is using the same chat context as frontend
        // The backend will create the chat context if it doesn't exist
        try {
          await switchBackendChat(chatId);
          console.log(`Backend switched to chat context: ${chatId}`);
        } catch (backendError) {
          console.error(
            `Failed to switch backend to chat ${chatId}:`,
            backendError
          );
          throw new Error(
            `Could not establish backend chat context: ${backendError}`
          );
        }

        const result = await addPdf(file, chatId);
        const doc: UploadedDoc = {
          name: result.filename ?? file.name,
          chunks: result.chunks,
        };

        // Update or add the document in the list
        setDocs((d) => {
          const existingIndex = d.findIndex(
            (existing) => existing.name === doc.name
          );
          if (existingIndex >= 0) {
            // Replace existing document
            const newDocs = [...d];
            newDocs[existingIndex] = doc;
            return newDocs;
          } else {
            // Add new document
            return [...d, doc];
          }
        });

        toast.success(`Added/Updated ${doc.name} (${doc.chunks} chunks)`);

        // Associate document with chat in storage
        ChatStorageManager.addDocumentToCurrentChat(doc.name, doc.chunks);

        if (onNotification) {
          onNotification(
            "Document added",
            `Successfully added ${doc.name} with ${doc.chunks} chunks to existing context`,
            "success"
          );
        }
      }

      // Note: We don't auto-clear chat when adding documents to existing context
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

      // Remove document from current chat's context
      ChatStorageManager.removeDocumentFromCurrentChat(name);

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
      // Get current chat's documents only
      const currentChatDocuments = ChatStorageManager.getCurrentChatDocuments();

      if (currentChatDocuments.length === 0) {
        toast.info("No documents to clear for current chat");
        if (showNotification && onNotification) {
          onNotification(
            "No documents",
            "Current chat has no documents to clear",
            "info"
          );
        }
        return;
      }

      // Delete only documents associated with current chat
      for (const docName of currentChatDocuments) {
        try {
          await deleteDocument(docName);
          console.log(`Cleared document: ${docName}`);
        } catch (e) {
          console.error(`Failed to clear document ${docName}:`, e);
        }
      }

      // Update UI - remove only current chat's documents
      setDocs((d) =>
        d.filter((doc) => !currentChatDocuments.includes(doc.name))
      );

      // Clear document context from current chat
      const currentChatId = ChatStorageManager.getCurrentChatId();
      if (currentChatId) {
        ChatStorageManager.updateDocumentContext(currentChatId, [], 0);
      }

      toast.success(
        `Cleared ${currentChatDocuments.length} document(s) from current chat`
      );

      if (showNotification && onNotification) {
        onNotification(
          "Documents cleared",
          `Removed ${currentChatDocuments.length} document(s) from current chat`,
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
    <>
      <Card className="border-muted/50">
        <CardHeader>
          <CardTitle>Manage PDFs</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Add PDFs to the AI's context. Multiple documents can be added to
            provide richer context for your questions.
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
            <p className="text-sm text-muted-foreground">
              No PDFs uploaded yet.
            </p>
          ) : (
            <>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Uploaded Documents:</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowClearAllDialog(true)}
                  disabled={clearingAll || loading}
                  className="text-destructive hover:text-destructive"
                >
                  {clearingAll ? "Clearing..." : "Clear Chat Documents"}
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

      <Dialog open={showClearAllDialog} onOpenChange={setShowClearAllDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Current Chat Documents</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove all documents from the current
              chat? This will only affect the current conversation and preserve
              documents in other chats.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowClearAllDialog(false)}
              disabled={clearingAll}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setShowClearAllDialog(false);
                await clearAllDocs();
              }}
              disabled={clearingAll}
            >
              {clearingAll ? "Clearing..." : "Yes, Clear Chat Documents"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
