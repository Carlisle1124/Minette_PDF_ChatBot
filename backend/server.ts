import express, { Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import pdfParse from "pdf-parse";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

app.post("/api/upload", upload.single("pdf"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded" });
    }

    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(pdfBuffer);
    const pdfText = pdfData.text;

    const ollamaResponse = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3",
        prompt: `Here is the PDF content:\n${pdfText}\n\nPlease summarize the document:`,
      }),
    });

    type OllamaResponse = { response: string };
    const data = (await ollamaResponse.json()) as OllamaResponse;

    fs.unlinkSync(req.file.path);

    res.json({ summary: data.response });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
