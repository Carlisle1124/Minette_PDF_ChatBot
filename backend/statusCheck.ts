import fetch from "node-fetch";

interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

async function checkOllama() {
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = (await res.json()) as { models: OllamaModel[] }; // ✅ assert type
    console.log("✅ Ollama server is running. Models available:");
    data.models.forEach((m) => console.log(`- ${m.name}`));
  } catch (err: any) {
    console.error("❌ Ollama server not reachable:", err.message);
    console.info("💡 Run 'ollama serve' and ensure port 11434 is free.");
  }
}

async function checkBackend() {
  try {
    const res = await fetch("http://localhost:5000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "Hello" }),
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    console.log("✅ Backend server is running on http://localhost:5000");
  } catch (err: any) {
    console.error("❌ Backend server not reachable:", err.message);
    console.info("💡 Run 'npx ts-node server.ts' and ensure port 5000 is free.");
  }
}

async function main() {
  console.log("Checking Ollama server...");
  await checkOllama();

  console.log("\nChecking Backend server...");
  await checkBackend();
}

main();
