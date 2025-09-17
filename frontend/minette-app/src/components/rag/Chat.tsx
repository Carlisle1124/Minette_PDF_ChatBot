// Chat.tsx
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DocumentUploader } from "./DocumentUploader";
import { toast } from "sonner";
import { chat } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export const Chat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const ask = async () => {
    const question = input.trim();
    if (!question) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: question }]);
    setBusy(true);

    try {
      const data = await chat(question);
      setMessages((m) => [...m, { role: "assistant", content: data.answer }]);
    } catch (e) {
      console.error(e);
      toast.error("Failed to reach backend, is it running?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-hero rounded-lg p-6 border">
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold">PDF AI Chatbot</h1>
          <p className="text-muted-foreground max-w-2xl">
            Upload PDFs and ask questions. The assistant uses your local Ollama
            model.
          </p>
          <DocumentUploader />
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
                messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={
                      msg.role === "user"
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }
                  >
                    <span className="text-xs uppercase tracking-wide mr-2 opacity-70">
                      {msg.role}
                    </span>
                    {msg.content}
                  </div>
                ))
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
              <Button onClick={ask} disabled={busy}>
                {busy ? "Thinking..." : "Ask"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
};
