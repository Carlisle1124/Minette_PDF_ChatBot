// Chat.tsx
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DocumentUploader } from "./DocumentUploader";
import { toast } from "sonner";
import { chat } from "@/lib/api";
import { RefreshCw, MessageSquarePlus } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { ErrorBoundary } from "@/components/ui/error-boundary";

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

  const listRef = useRef<HTMLDivElement>(null);

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

    setMessages((m) => [...m, { role: "user", content: question }]);
    setBusy(true);
    setErrorState(false);

    try {
      const data = await chat(question);

      // Ensure we have a valid response
      if (data && data.answer) {
        const answerContent =
          typeof data.answer === "string"
            ? data.answer
            : Array.isArray(data.answer)
            ? (data.answer as string[]).join(" ")
            : String(data.answer);

        setMessages((m) => [
          ...m,
          { role: "assistant", content: answerContent },
        ]);

        if (onNotification) {
          onNotification(
            "Response received",
            "AI has successfully responded to your query",
            "success"
          );
        }
      } else {
        throw new Error("Invalid response format from backend");
      }
    } catch (e) {
      setErrorState(true);
      const errorMessage = "Failed to reach backend, is it running?";
      toast.error(errorMessage);

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

  const startNewChat = () => {
    setMessages([]);
    setErrorState(false);
    setInput("");
    setLastUserMessage("");
    if (onNotification) {
      onNotification("New Chat", "Started a new chat session", "info");
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-hero rounded-lg p-6 border">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-semibold">PDF AI Chatbot</h1>
            <Button
              variant="outline"
              onClick={startNewChat}
              className="flex items-center gap-2"
              disabled={busy}
            >
              <MessageSquarePlus className="h-4 w-4" />
              New Chat
            </Button>
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
                        {msg.role}
                      </span>
                      <div className="mt-1">
                        {msg.role === "assistant" ? (
                          <div className="whitespace-pre-wrap break-words">
                            {msg.content || "No response"}
                          </div>
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
                {busy ? "Thinking..." : "Ask"}
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
    </div>
  );
};
