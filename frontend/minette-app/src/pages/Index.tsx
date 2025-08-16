import { Chat } from "@/components/rag/Chat";
import turtle from "@/assets/minette-turtle.png";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

const Index = () => {
  return (
    <main className="container py-10 space-y-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src={turtle} alt="Minette turtle logo" className="h-10 w-10" loading="lazy" />
          <div className="space-y-1">
            <h1 className="text-3xl font-bold">Minette</h1>
            <p className="text-muted-foreground">Local-first RAG with Ollama (Llama 3) + semantic search.</p>
          </div>
        </div>
        <ThemeToggle />
      </header>
      <Chat />
    </main>
  );
};

export default Index;
