import express, { Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import pdfParse from "pdf-parse";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

// Store uploaded PDFs in memory (chunks)
interface PdfChunk {
  text: string;
}
let pdfChunks: PdfChunk[] = [];

const upload = multer({ dest: "uploads/" });

// --- Upload PDF endpoint ---
app.post("/api/upload", upload.single("pdf"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text;

    // Simple chunking by splitting every 1000 characters
    const chunks: PdfChunk[] = [];
    for (let i = 0; i < text.length; i += 1000) {
      chunks.push({ text: text.slice(i, i + 1000) });
    }

    pdfChunks.push(...chunks);
    fs.unlinkSync(req.file.path);

    // Generate a quick summary using Ollama
    const prompt = `Summarize the following PDF text:\n${text}`;
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "llama3", prompt }),
    });

    const data = (await response.json()) as { response: string };

    res.json({ summary: data.response, chunks });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message || "Something went wrong" });
  }
});

// --- Chat endpoint ---
app.post("/api/chat", async (req: Request, res: Response) => {
  try {
    const { query, contexts } = req.body as { query: string; contexts: PdfChunk[] };

    // Combine top contexts into a single prompt
    const combinedText = (contexts || pdfChunks)
      .map((c: PdfChunk) => c.text)
      .join("\n\n");

    const prompt = `You are an AI assistant. Use the following PDF content to answer the question.\n\nPDF Content:\n${combinedText}\n\nQuestion: ${query}\nAnswer:`;

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "llama3", prompt }),
    });

    const data = (await response.json()) as { response: string };

    res.json({ answer: data.response });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message || "Something went wrong" });
  }
});

app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
