// Chat.tsx
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DocumentUploader } from "./DocumentUploader";
import { toast } from "sonner";
import {
  chat,
  clearAllDocuments,
  chatStream,
  fetchDocuments,
  checkDocumentsLoaded,
} from "@/lib/api";
import { RefreshCw, MessageSquarePlus, MessageSquare } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ChatStorageManager,
  ChatHistory,
  ChatMessage,
} from "@/lib/chatStorage";
import { ChatHistorySidebar } from "./ChatHistorySidebar";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatProps {
  onNotification?: (
    title: string,
    message: string,
    type?: "info" | "success" | "warning" | "error"
  ) => void;
  onDocumentDeleted?: () => void;
}

export const Chat = ({ onNotification, onDocumentDeleted }: ChatProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorState, setErrorState] = useState(false);
  const [lastUserMessage, setLastUserMessage] = useState<string>("");
  const [showNewChatDialog, setShowNewChatDialog] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);

  // Load current chat on component mount
  useEffect(() => {
    const currentId = ChatStorageManager.getCurrentChatId();
    if (currentId) {
      const chat = ChatStorageManager.getChat(currentId);
      if (chat) {
        setCurrentChatId(currentId);
        setMessages(
          chat.messages.map((msg) => ({ role: msg.role, content: msg.content }))
        );
      }
    }
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const ask = async (questionOverride?: string) => {
    const question = questionOverride || input.trim();
    if (!question) return;

    if (!questionOverride) {
      setInput("");
      setLastUserMessage(question);
    }

    // Create or get current chat
    let chatId = currentChatId;
    if (!chatId) {
      const title = ChatStorageManager.generateChatTitle(question);
      const newChat = ChatStorageManager.createNewChat(title);
      chatId = newChat.id;
      setCurrentChatId(chatId);
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: question,
      timestamp: new Date(),
    };

    // Save user message
    ChatStorageManager.addMessageToChat(chatId, userMessage);

    setMessages((m) => [...m, { role: "user", content: question }]);
    setBusy(true);
    setErrorState(false);

    try {
      // Add an empty assistant message that we'll populate as we stream
      let currentAssistantMessage = "";
      setMessages((m) => [...m, { role: "assistant", content: "" }]);

      // Get documents for current chat to filter queries
      const currentChatDocuments = chatId
        ? ChatStorageManager.getChat(chatId)?.documentContext.filenames || []
        : [];

      console.log("Querying with document filter:", currentChatDocuments);

      const stream = chatStream(
        question,
        undefined,
        currentChatDocuments.length > 0 ? currentChatDocuments : undefined
      );

      for await (const chunk of stream) {
        if (chunk.type === "content") {
          // Append the new content to the current message
          currentAssistantMessage += chunk.data;

          // Update the last message (which should be the assistant message)
          setMessages((m) => {
            const newMessages = [...m];
            if (
              newMessages.length > 0 &&
              newMessages[newMessages.length - 1].role === "assistant"
            ) {
              newMessages[newMessages.length - 1].content =
                currentAssistantMessage;
            }
            return newMessages;
          });
        } else if (chunk.type === "contexts") {
          // We could store contexts if needed for display
          console.log("Received contexts:", chunk.data);
        } else if (chunk.type === "error") {
          throw new Error(chunk.data.message);
        } else if (chunk.type === "done") {
          console.log("Streaming completed");
          break;
        }
      }

      // Save assistant message to storage
      if (currentAssistantMessage) {
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: currentAssistantMessage,
          timestamp: new Date(),
        };
        ChatStorageManager.addMessageToChat(chatId, assistantMessage);
      }

      if (onNotification) {
        onNotification(
          "Response received",
          "AI has successfully responded to your query",
          "success"
        );
      }
    } catch (e: any) {
      setErrorState(true);
      const errorMessage =
        e.message?.includes("fetch") || e.message?.includes("network")
          ? "Failed to reach backend, is it running?"
          : `Error: ${e.message}`;
      toast.error(errorMessage);

      // Remove the empty assistant message if there was an error
      setMessages((m) => {
        const newMessages = [...m];
        if (
          newMessages.length > 0 &&
          newMessages[newMessages.length - 1].role === "assistant" &&
          !newMessages[newMessages.length - 1].content
        ) {
          newMessages.pop();
        }
        return newMessages;
      });

      if (onNotification) {
        onNotification("Backend Error", errorMessage, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleReprompt = () => {
    if (lastUserMessage) {
      ask(lastUserMessage);
    }
  };

  const handleDocumentDeleted = () => {
    setMessages([]);
    setErrorState(false);
    if (onDocumentDeleted) {
      onDocumentDeleted();
    }
    if (onNotification) {
      onNotification(
        "Chat Reset",
        "Chat history cleared due to document changes",
        "info"
      );
    }
  };

  const handleChatSelect = async (chat: ChatHistory) => {
    try {
      // NOTE: We DO NOT clear documents from vector store anymore
      // Documents remain persistent and we filter by chat context during queries

      // Load the selected chat
      setMessages(
        chat.messages.map((msg) => ({ role: msg.role, content: msg.content }))
      );
      setCurrentChatId(chat.id);
      setErrorState(false);
      setInput("");
      ChatStorageManager.setCurrentChatId(chat.id);

      // Check if this chat has associated documents
      const chatDocuments = chat.documentContext.filenames;
      if (chatDocuments.length > 0) {
        // Check which documents are still available in the backend
        const documentStatus = await checkDocumentsLoaded(chatDocuments);
        const availableDocs = Object.entries(documentStatus)
          .filter(([_, isLoaded]) => isLoaded)
          .map(([filename]) => filename);

        const missingDocs = chatDocuments.filter(
          (doc) => !availableDocs.includes(doc)
        );

        if (missingDocs.length > 0) {
          if (onNotification) {
            onNotification(
              "Document Context Warning",
              `Some documents from this chat are no longer available: ${missingDocs.join(
                ", "
              )}. You may need to re-upload them.`,
              "warning"
            );
          }
        }

        if (availableDocs.length > 0) {
          if (onNotification) {
            onNotification(
              "Chat Loaded",
              `Loaded chat "${chat.title}" with ${availableDocs.length} document(s) available`,
              "info"
            );
          }
        } else {
          if (onNotification) {
            onNotification(
              "Chat Loaded",
              `Loaded chat "${chat.title}" but documents need to be re-uploaded`,
              "warning"
            );
          }
        }
      } else {
        if (onNotification) {
          onNotification(
            "Chat Loaded",
            `Switched to chat: ${chat.title} (no documents)`,
            "info"
          );
        }
      }

      // Notify parent component to refresh document list display
      if (onDocumentDeleted) {
        onDocumentDeleted();
      }
    } catch (error) {
      console.error("Error switching chat:", error);
      if (onNotification) {
        onNotification(
          "Chat Switch Error",
          "Failed to switch chat context. Please try again.",
          "error"
        );
      }
    }
  };

  const startNewChat = async () => {
    try {
      // NOTE: We do NOT clear all documents from vector store anymore
      // Documents remain persistent across all chats

      // Clear current chat context (but not documents)
      const oldChatId = currentChatId;

      // Clear chat state
      setMessages([]);
      setErrorState(false);
      setInput("");
      setLastUserMessage("");
      setCurrentChatId(null);

      // Clear current chat in storage
      ChatStorageManager.clearCurrentChatId();

      // Close the dialog
      setShowNewChatDialog(false);

      if (onNotification) {
        onNotification(
          "New Chat",
          "Started a new chat session. Documents remain available for all chats.",
          "info"
        );
      }

      // Notify parent component to refresh document list display
      if (onDocumentDeleted) {
        onDocumentDeleted();
      }
    } catch (e: any) {
      console.error(e);
      const errorMessage =
        "Failed to clear documents: " + (e.message ?? e.toString());
      toast.error(errorMessage);

      if (onNotification) {
        onNotification("Clear failed", errorMessage, "error");
      }
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-hero rounded-lg p-6 border">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-semibold">PDF AI Chatbot</h1>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setChatHistoryOpen(true)}
                className="flex items-center gap-2"
              >
                <MessageSquare className="h-4 w-4" />
                Chats
              </Button>
              <AlertDialog
                open={showNewChatDialog}
                onOpenChange={setShowNewChatDialog}
              >
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="flex items-center gap-2"
                    disabled={busy}
                  >
                    <MessageSquarePlus className="h-4 w-4" />
                    New Chat
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Start New Chat</AlertDialogTitle>
                    <AlertDialogDescription>
                      Do you want to add a new chat? This will clear the current
                      conversation and document context.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={startNewChat}>
                      Yes, Start New Chat
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          <p className="text-muted-foreground max-w-2xl">
            Upload PDFs and ask questions. The assistant uses your local Ollama
            model.
          </p>
          <DocumentUploader
            onDocumentDeleted={handleDocumentDeleted}
            onNotification={onNotification}
          />
        </div>
      </section>

      <section>
        <Card>
          <CardContent className="p-0">
            <div
              ref={listRef}
              className="max-h-[50vh] overflow-auto p-4 space-y-4"
            >
              {messages.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No messages yet. Upload a PDF and ask a question!
                </div>
              ) : (
                <ErrorBoundary>
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`mb-4 ${
                        msg.role === "user"
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      <span className="text-xs uppercase tracking-wide mr-2 opacity-70">
                        {msg.role === "user" ? "user" : "minette"}
                      </span>
                      <div className="mt-1">
                        {msg.role === "assistant" ? (
                          msg.content ? (
                            <div className="whitespace-pre-wrap break-words">
                              {msg.content}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <div className="animate-pulse">Thinking...</div>
                            </div>
                          )
                        ) : (
                          <span className="break-words">{msg.content}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </ErrorBoundary>
              )}
            </div>
            <Separator />
            <div className="p-3 flex items-center gap-2">
              <Input
                placeholder="Ask anything about your documents..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && ask()}
                aria-label="Question"
              />
              <Button onClick={() => ask()} disabled={busy}>
                {busy ? "Streaming..." : "Ask"}
              </Button>
              {errorState && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleReprompt}
                  className="ml-2"
                  title="Retry last prompt"
                  disabled={busy}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <ChatHistorySidebar
        isOpen={chatHistoryOpen}
        onOpenChange={setChatHistoryOpen}
        onChatSelect={handleChatSelect}
        currentChatId={currentChatId}
      />
    </div>
  );
};
