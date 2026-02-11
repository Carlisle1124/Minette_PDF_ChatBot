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
  createNewBackendChat,
  switchBackendChat,
} from "@/lib/api";
import {
  RefreshCw,
  MessageSquarePlus,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
} from "lucide-react";
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
import { useSettings } from "@/lib/settingsStorage";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
}

interface ChatProps {
  onNotification?: (
    title: string,
    message: string,
    type?: "info" | "success" | "warning" | "error",
  ) => void;
  onDocumentDeleted?: () => void;
}

// Collapsible message component for long messages
const CollapsibleMessage = ({
  content,
  role,
}: {
  content: string;
  role: "user" | "assistant";
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const CHAR_LIMIT = 800;
  const isLong = content.length > CHAR_LIMIT;

  if (!isLong) {
    return (
      <div className="whitespace-pre-wrap break-words leading-relaxed">
        {content}
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        className={`whitespace-pre-wrap break-words leading-relaxed ${
          !isExpanded ? "max-h-48 overflow-hidden" : ""
        }`}
      >
        {isExpanded ? content : content.substring(0, CHAR_LIMIT) + "..."}
      </div>
      {!isExpanded && (
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent pointer-events-none" />
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsExpanded(!isExpanded)}
        className="mt-2 h-7 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {isExpanded ? (
          <>
            <ChevronUp className="h-3 w-3 mr-1" />
            Show less
          </>
        ) : (
          <>
            <ChevronDown className="h-3 w-3 mr-1" />
            Show more ({Math.round((content.length - CHAR_LIMIT) / 100) * 100}+
            chars)
          </>
        )}
      </Button>
    </div>
  );
};

// Thinking indicator with animated dots
const ThinkingIndicator = () => (
  <div className="flex items-center gap-1.5">
    <span className="thinking-dot" />
    <span className="thinking-dot" />
    <span className="thinking-dot" />
  </div>
);

export const Chat = ({ onNotification, onDocumentDeleted }: ChatProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorState, setErrorState] = useState(false);
  const [lastUserMessage, setLastUserMessage] = useState<string>("");
  const [showNewChatDialog, setShowNewChatDialog] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isSwitchingChat, setIsSwitchingChat] = useState(false);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);

  const { settings } = useSettings();
  const listRef = useRef<HTMLDivElement>(null);

  // Load current chat on component mount
  useEffect(() => {
    const currentId = ChatStorageManager.getCurrentChatId();
    if (currentId) {
      const chat = ChatStorageManager.getChat(currentId);
      if (chat) {
        setCurrentChatId(currentId);
        setMessages(
          chat.messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
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

    // IMPORTANT: Always sync with localStorage first in case DocumentUploader created a chat
    let chatId = ChatStorageManager.getCurrentChatId();

    // If localStorage has a chat ID but state doesn't, update the state
    if (chatId && chatId !== currentChatId) {
      console.log(`Syncing chat ID from localStorage: ${chatId}`);
      setCurrentChatId(chatId);
    }

    // Only create a new chat if none exists in both state and localStorage
    if (!chatId) {
      const title = ChatStorageManager.generateChatTitle(question);
      const newChat = ChatStorageManager.createNewChat(title);
      chatId = newChat.id;
      setCurrentChatId(chatId);
      console.log(`Created new chat: ${chatId}`);
    }

    // Always ensure backend is using the same chat context as frontend
    try {
      await switchBackendChat(chatId);
      console.log(`Backend switched to chat context: ${chatId}`);
    } catch (backendError) {
      console.error(
        `Failed to switch backend to chat ${chatId}:`,
        backendError,
      );
      setBusy(false);
      setErrorState(true);
      const errorMessage = `Could not establish backend chat context: ${backendError}`;
      toast.error(errorMessage);
      if (onNotification) {
        onNotification("Backend Chat Error", errorMessage, "error");
      }
      return;
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: question,
      timestamp: new Date(),
    };

    // Save user message
    ChatStorageManager.addMessageToChat(chatId, userMessage);

    setMessages((m) => [
      ...m,
      { role: "user", content: question, timestamp: new Date() },
    ]);
    setBusy(true);
    setErrorState(false);

    try {
      // Add an empty assistant message that we'll populate as we stream
      let currentAssistantMessage = "";
      const assistantTimestamp = new Date();
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "", timestamp: assistantTimestamp },
      ]);

      // Use current chat context for the query (backend will handle isolation)
      console.log(
        "Querying with chat context:",
        chatId,
        "maxTokens:",
        settings.maxTokens,
      );

      const stream = chatStream(
        question,
        chatId || undefined,
        undefined,
        settings.maxTokens,
        settings.selectedModel,
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
          "success",
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
        "info",
      );
    }
  };

  // Handler when a document is uploaded - sync the chat ID
  const handleDocumentUploaded = (chatId: string) => {
    console.log(`Document uploaded to chat: ${chatId}`);
    if (chatId !== currentChatId) {
      setCurrentChatId(chatId);
      console.log(`Updated currentChatId state to: ${chatId}`);
    }
  };

  const handleChatSelect = async (chat: ChatHistory) => {
    setIsSwitchingChat(true);
    try {
      // Switch backend context to this chat
      const switchResult = await switchBackendChat(chat.id);
      console.log("Switched to chat:", switchResult);

      // Load the selected chat with timestamps
      setMessages(
        chat.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
        })),
      );
      setCurrentChatId(chat.id);
      setErrorState(false);
      setInput("");
      ChatStorageManager.setCurrentChatId(chat.id);

      // Show notification about the loaded chat
      if (onNotification) {
        const docCount = switchResult.total_chunks;
        const docFiles = Object.keys(switchResult.documents || {}).length;

        if (docFiles > 0) {
          onNotification(
            "Chat Loaded",
            `Loaded chat "${chat.title}" with ${docFiles} document(s) (${docCount} chunks)`,
            "info",
          );
        } else {
          onNotification(
            "Chat Loaded",
            `Switched to chat: ${chat.title} (no documents)`,
            "info",
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
          "error",
        );
      }
    } finally {
      setIsSwitchingChat(false);
    }
  };

  // Handler for when a chat is deleted from sidebar
  const handleChatDeletedFromSidebar = () => {
    // If the deleted chat was the current one, clear the state
    setMessages([]);
    setErrorState(false);
    setInput("");
    setCurrentChatId(null);
    ChatStorageManager.clearCurrentChatId();

    if (onNotification) {
      onNotification(
        "Chat Deleted",
        "The current chat was deleted. Start a new conversation.",
        "info",
      );
    }

    if (onDocumentDeleted) {
      onDocumentDeleted();
    }
  };

  const startNewChat = async () => {
    try {
      // Clear frontend chat state first
      setMessages([]);
      setErrorState(false);
      setInput("");
      setLastUserMessage("");
      setCurrentChatId(null);

      // Clear current chat in storage
      ChatStorageManager.clearCurrentChatId();

      // Clear backend context (no active chat)
      await createNewBackendChat();

      // Close the dialog
      setShowNewChatDialog(false);

      if (onNotification) {
        onNotification(
          "New Chat",
          "Started a new chat session with fresh document context.",
          "info",
        );
      }

      // Notify parent component to refresh document list display
      if (onDocumentDeleted) {
        onDocumentDeleted();
      }
    } catch (e: any) {
      console.error(e);
      const errorMessage =
        "Failed to start new chat: " + (e.message ?? e.toString());
      toast.error(errorMessage);

      if (onNotification) {
        onNotification("New Chat failed", errorMessage, "error");
      }
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <section className="bg-hero rounded-lg p-4 sm:p-6 border">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h1 className="text-2xl sm:text-3xl font-semibold">
              PDF AI Chatbot
            </h1>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setChatHistoryOpen(true)}
                className="flex items-center gap-2 flex-1 sm:flex-none justify-center"
                size="sm"
              >
                <MessageSquare className="h-4 w-4" />
                <span className="sm:inline">Chats</span>
              </Button>
              <AlertDialog
                open={showNewChatDialog}
                onOpenChange={setShowNewChatDialog}
              >
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="flex items-center gap-2 flex-1 sm:flex-none justify-center"
                    disabled={busy}
                    size="sm"
                  >
                    <MessageSquarePlus className="h-4 w-4" />
                    <span className="sm:inline">New Chat</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="max-w-[90vw] sm:max-w-lg">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Start New Chat</AlertDialogTitle>
                    <AlertDialogDescription>
                      Do you want to add a new chat? This will clear the current
                      conversation and document context.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                    <AlertDialogCancel className="w-full sm:w-auto">
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={startNewChat}
                      className="w-full sm:w-auto"
                    >
                      Yes, Start New Chat
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          <DocumentUploader
            onDocumentDeleted={handleDocumentDeleted}
            onNotification={onNotification}
            onDocumentUploaded={handleDocumentUploaded}
            currentChatId={currentChatId}
          />
        </div>
      </section>

      <section>
        <Card
          className={`relative overflow-hidden chat-card-premium ${
            busy ? "chat-streaming" : ""
          }`}
        >
          <CardContent className="p-0">
            {/* Loading overlay when switching chats */}
            {isSwitchingChat && (
              <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10 rounded-lg">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm font-medium">Loading chat...</span>
                </div>
              </div>
            )}
            <div
              ref={listRef}
              className={`chat-scrollbar overflow-auto p-4 sm:p-5 space-y-4 transition-all duration-300 ease-out ${
                messages.length === 0
                  ? ""
                  : messages.length <= 2
                    ? "min-h-[180px] max-h-[32vh]"
                    : messages.length <= 4
                      ? "min-h-[220px] max-h-[42vh]"
                      : "min-h-[280px] max-h-[52vh] sm:max-h-[62vh]"
              }`}
            >
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-6 px-4">
                  <div className="rounded-full bg-muted/50 p-3.5 mb-4">
                    <MessageSquare className="h-6 w-6 text-muted-foreground/70" />
                  </div>
                  <p className="font-medium text-foreground/90 mb-1.5 text-sm">
                    No messages yet
                  </p>
                  <p className="text-xs text-muted-foreground max-w-[240px] leading-relaxed">
                    Upload a PDF and ask a question to get started!
                  </p>
                </div>
              ) : (
                <ErrorBoundary>
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`message-animate p-4 rounded-xl transition-all duration-200 ${
                        msg.role === "user"
                          ? "bg-purple-100 dark:bg-muted/40 border-l-[3px] border-primary/70 shadow-md dark:shadow-none"
                          : "bg-purple-50 dark:bg-card/50 border border-purple-200 dark:border-border/50 shadow-md dark:shadow-none"
                      }`}
                      style={{ animationDelay: `${idx * 50}ms` }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/80">
                          {msg.role === "user" ? "You" : "Minette"}
                        </span>
                        {msg.timestamp && (
                          <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1.5">
                            <Clock className="h-3 w-3" />
                            {new Date(msg.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                      </div>
                      <div className="text-sm sm:text-[15px] leading-relaxed">
                        {msg.role === "assistant" ? (
                          msg.content ? (
                            <CollapsibleMessage
                              content={msg.content}
                              role={msg.role}
                            />
                          ) : (
                            <div className="flex items-center gap-3 text-muted-foreground py-1">
                              <ThinkingIndicator />
                              <span className="text-sm">Thinking...</span>
                            </div>
                          )
                        ) : (
                          <CollapsibleMessage
                            content={msg.content}
                            role={msg.role}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </ErrorBoundary>
              )}
            </div>
            <Separator className="opacity-50" />
            <div
              className={`p-3 sm:p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 ${
                busy ? "chat-disabled" : ""
              }`}
            >
              <Input
                placeholder="Ask anything about your documents..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && !busy && !isSwitchingChat && ask()
                }
                aria-label="Question"
                disabled={isSwitchingChat || busy}
                className="h-11 sm:h-10 chat-input-premium bg-muted/30 border-border/60 focus:bg-background"
              />
              <div className="flex gap-2 shrink-0">
                <Button
                  onClick={() => ask()}
                  disabled={busy || isSwitchingChat}
                  className={`flex-1 sm:flex-none h-11 sm:h-10 px-6 font-medium ${
                    !busy && !isSwitchingChat ? "ask-button-glow" : ""
                  }`}
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Generating...
                    </>
                  ) : (
                    "Ask"
                  )}
                </Button>
                {errorState && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleReprompt}
                    title="Retry last prompt"
                    disabled={busy || isSwitchingChat}
                    className="h-11 w-11 sm:h-10 sm:w-10 shrink-0 transition-all hover:border-primary/50"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <ChatHistorySidebar
        isOpen={chatHistoryOpen}
        onOpenChange={setChatHistoryOpen}
        onChatSelect={handleChatSelect}
        currentChatId={currentChatId ?? undefined}
        onChatDeleted={handleChatDeletedFromSidebar}
      />
    </div>
  );
};
