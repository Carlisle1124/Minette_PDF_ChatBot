import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DocumentUploader } from "./DocumentUploader";
import { vectorStore } from "@/lib/vectorstore";
import { embedTexts } from "@/lib/embeddings";
import { toast } from "sonner";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export const Chat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [apiBase, setApiBase] = useState(
    localStorage.getItem("rag_api_base") || "http://localhost:8000"
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const systemHint = useMemo(
    () =>
      "Ask questions about your uploaded PDFs. The assistant will search semantically and answer using the most relevant excerpts.",
    []
  );

  const ask = async () => {
    const question = input.trim();
    if (!question) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: question }]);
    setBusy(true);

    try {
      // Retrieve
      const [qVec] = await embedTexts([question]);
      const top = vectorStore.searchByVector(qVec, 5);
      const contexts = top.map((t) => t.doc.text);

      // Try local backend first
      let answered = false;
      try {
        const res = await fetch(`${apiBase}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, contexts }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.answer) {
            setMessages((m) => [...m, { role: "assistant", content: data.answer }]);
            answered = true;
          }
        } else {
          console.warn("Backend responded with status", res.status);
        }
      } catch (e) {
        console.warn("Backend unreachable or CORS blocked", e);
      }

      if (!answered) {
        const fallback =
          "I couldn't reach a local backend. Here are the most relevant excerpts:\n\n" +
          contexts.map((c, i) => `#${i + 1}: ${c}`).join("\n\n");
        setMessages((m) => [...m, { role: "assistant", content: fallback }]);
        toast.info("Tip: Start your FastAPI server at /chat for generative answers.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to answer the question");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-hero rounded-lg p-6 border">
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold">PDF AI Chatbot</h1>
          <p className="text-muted-foreground max-w-2xl">{systemHint}</p>
          <DocumentUploader />
        </div>
      </section>

      <section>
        <Card>
          <CardContent className="p-0">
            <div ref={listRef} className="max-h-[50vh] overflow-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="text-sm text-muted-foreground">No messages yet. Upload a PDF and ask a question!</div>
              ) : (
                messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={
                      msg.role === "user" ? "text-foreground" : "text-muted-foreground"
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

      <section className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Local API base:</span>
        <Input
          value={apiBase}
          onChange={(e) => {
            setApiBase(e.target.value);
            localStorage.setItem("rag_api_base", e.target.value);
          }}
        />
        <span className="text-muted-foreground">Endpoint: POST /chat</span>
      </section>
    </div>
  );
};
