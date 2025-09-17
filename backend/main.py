from __future__ import annotations

import io
import os
from typing import List

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from utils.ollama_client import OllamaClient
from utils.chunker import chunk_text
from rag_pipeline import RAGPipeline

try:
    import pdfplumber  # type: ignore
except Exception:
    pdfplumber = None

app = FastAPI(title="Minette PDF Ollama API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ollama = OllamaClient()

rag = RAGPipeline(persist_directory=os.path.join("backend", "db", "chrome_store"))


class ChatRequest(BaseModel):
    message: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/ingest/pdf")
async def ingest_pdf(file: UploadFile = File(...)) -> dict:
    if pdfplumber is None:
        raise RuntimeError("pdfplumber is required. Install with: pip install pdfplumber")

    content = await file.read()
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        pages_text = [page.extract_text() or "" for page in pdf.pages]
    full_text = "\n\n".join(pages_text)
    doc_id = os.path.splitext(file.filename or "document")[0]
    num_chunks = rag.ingest_document(doc_id=doc_id, text=full_text, metadata={"filename": file.filename})
    return {"filename": file.filename, "chunks": num_chunks}


@app.post("/chat")
def chat(req: ChatRequest) -> dict:
    answer, contexts = rag.rag_answer(req.message)
    return {
        "answer": answer,
        "contexts": [
            {"text": c.text, "score": c.score}
            for c in contexts
        ],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

#this will be FastAPI/Flask entrypoint