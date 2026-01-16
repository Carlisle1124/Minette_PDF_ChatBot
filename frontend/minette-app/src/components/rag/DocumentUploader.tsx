import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Trash2, Loader2, Upload } from "lucide-react";
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
  getCurrentBackendChat,
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
  onDocumentUploaded?: (chatId: string) => void;
  currentChatId?: string | null;
}

export const DocumentUploader = ({
  onDocumentDeleted,
  onNotification,
  onDocumentUploaded,
  currentChatId,
}: DocumentUploaderProps) => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Load documents and sync backend when currentChatId changes
  useEffect(() => {
    const loadDocumentsForChat = async () => {
      // If no chat ID, clear the docs list (new chat scenario)
      if (!currentChatId) {
        setDocs([]);
        return;
      }

      setIsLoadingDocs(true);
      try {
        // IMPORTANT: Switch backend to this chat context first
        // This ensures the backend's vector store is in sync
        await switchBackendChat(currentChatId);
        console.log(`Backend switched to chat context: ${currentChatId}`);

        // Get documents from the current chat's storage
        const chat = ChatStorageManager.getChat(currentChatId);
        if (chat && chat.documentContext.filenames.length > 0) {
          // Build docs list from chat's document context
          const chatDocs: UploadedDoc[] = chat.documentContext.filenames.map(
            (filename) => ({
              name: filename,
              chunks: 0, // We don't store individual chunk counts per file
            })
          );
          setDocs(chatDocs);
          console.log(
            `Loaded ${chatDocs.length} documents for chat ${currentChatId}`
          );
        } else {
          // No documents in this chat
          setDocs([]);
          console.log(`No documents found for chat ${currentChatId}`);
        }
      } catch (error) {
        console.error("Error loading documents for chat:", error);
        setDocs([]);
      } finally {
        setIsLoadingDocs(false);
      }
    };

    loadDocumentsForChat();
  }, [currentChatId]);

  const onFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    // Validate that all files are PDFs
    const invalidFiles = Array.from(files).filter(
      (file) => file.type !== "application/pdf"
    );

    if (invalidFiles.length > 0) {
      toast.error(
        `Only PDF files are allowed. Invalid files: ${invalidFiles
          .map((f) => f.name)
          .join(", ")}`
      );
      return;
    }

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

        // Notify parent that document was uploaded to this chat
        if (onDocumentUploaded) {
          onDocumentUploaded(chatId);
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
      // Pass currentChatId to ensure backend deletes from correct chat context
      await deleteDocument(name, currentChatId ?? undefined);
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

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (loading || isLoadingDocs) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      onFilesSelected(files);
    }
  };

  return (
    <>
      <Card className="border-muted/50 relative">
        {/* Loading overlay when switching chats */}
        {isLoadingDocs && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10 rounded-lg">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Loading documents...</span>
            </div>
          </div>
        )}
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Manage PDFs</CardTitle>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Add PDFs to the AI's context. Multiple documents can be added to
            provide richer context for your questions.
            {currentChatId && (
              <span className="block text-xs mt-1 opacity-70">
                Chat: {currentChatId.substring(0, 8)}...
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-4 sm:p-6 pt-0 sm:pt-0">
          {/* Drag and Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              relative border-2 border-dashed rounded-lg p-6 transition-all duration-200
              ${
                isDragging
                  ? "border-primary bg-primary/5 scale-[1.02]"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50"
              }
              ${
                loading || isLoadingDocs
                  ? "opacity-50 cursor-not-allowed"
                  : "cursor-pointer"
              }
            `}
          >
            <input
              type="file"
              accept="application/pdf"
              multiple
              onChange={(e) => onFilesSelected(e.target.files)}
              disabled={loading || isLoadingDocs}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
              id="pdf-upload-input"
            />
            <div className="flex flex-col items-center justify-center gap-3 text-center pointer-events-none">
              <div className="p-3 rounded-full bg-primary/10">
                {loading ? (
                  <Loader2 className="h-8 w-8 text-primary animate-spin" />
                ) : (
                  <Upload className="h-8 w-8 text-primary" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium mb-1">
                  {loading ? (
                    status ?? "Processing..."
                  ) : isDragging ? (
                    "Drop PDF files here"
                  ) : (
                    <>
                      <span className="text-primary">Click me to upload</span>{" "}
                      or drag and drop
                    </>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">PDF files only</p>
              </div>
            </div>
          </div>

          <Separator />

          {docs.length === 0 ? (
            <></>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-2">
                <span className="text-xs sm:text-sm font-medium">
                  Uploaded Documents ({docs.length}):
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowClearAllDialog(true)}
                  disabled={clearingAll || loading}
                  className="text-destructive hover:text-destructive text-xs sm:text-sm h-8 w-full sm:w-auto"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  {clearingAll ? "Clearing..." : "Clear All"}
                </Button>
              </div>
              <ul className="space-y-2 max-h-[200px] overflow-y-auto">
                {docs.map(({ name, chunks }) => (
                  <li
                    key={name}
                    className="flex items-center justify-between rounded-md border p-2 sm:p-3 gap-2"
                  >
                    <div className="truncate min-w-0 flex-1">
                      <span className="font-medium text-xs sm:text-sm block truncate">
                        {name}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {chunks} chunks
                      </span>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => removeDoc(name)}
                      disabled={deleting === name || loading || clearingAll}
                      className="h-8 w-8 sm:h-9 sm:w-auto sm:px-3 shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="hidden sm:inline ml-1">
                        {deleting === name ? "..." : "Remove"}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={showClearAllDialog} onOpenChange={setShowClearAllDialog}>
        <DialogContent className="max-w-[90vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Clear Current Chat Documents</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove all documents from the current
              chat? This will only affect the current conversation and preserve
              documents in other chats.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setShowClearAllDialog(false)}
              disabled={clearingAll}
              className="w-full sm:w-auto"
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
              className="w-full sm:w-auto"
            >
              {clearingAll ? "Clearing..." : "Yes, Clear Documents"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
