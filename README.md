# Minette.ai — Local PDF Chatbot

A retrieval-augmented chatbot for your PDFs that runs **entirely on your own
machine**. No document, no embedding and no query ever leaves the host.

The point of building it this way: the documents most worth asking questions
about — contracts, transcripts, medical records, internal reports — are exactly
the ones you cannot paste into a hosted inference endpoint.

📖 **[Read the full case study](https://frncsghn.vercel.app/projects/minette-ai)**

---

## How it works

```
React frontend  ──HTTP──▶  FastAPI backend  ──▶  ChromaDB (local, persistent)
                                  │
                                  ▼
                        embed query + retrieve top-k chunks
                                  │
                                  ▼
                     context + question ──▶ Ollama (local LLM)
                                  │
                                  ▼
                        streamed answer ──▶ React
```

Everything in that diagram runs on localhost. ChromaDB's anonymized telemetry is
disabled before the library is imported, because a privacy guarantee that only
covers the obvious network call is not a guarantee.

## Stack

**Backend** — Python, FastAPI, ChromaDB, pdfplumber, Ollama, Hugging Face Hub
**Frontend** — React, TypeScript, Vite, Tailwind CSS, shadcn/ui
**Models** — `llama3.1:8b` for chat, `nomic-embed-text` for embeddings (both
configurable via environment variables)

## Design notes

**Paragraph-aware chunking.** Text is normalized, split on blank lines, then
paragraphs are grouped toward a 1200-character target with a 400-character floor
and a 150-character overlap carried between consecutive chunks. Fixed-width
splitting was tried first and produced chunks that retrieved well on keywords and
read as nonsense in context.

**Low temperature by default.** Generation runs at 0.2 — the failure mode that
matters in document Q&A is a confident invention, not a dull answer.

**Documents scoped per conversation.** Each chunk is keyed `doc_id:index` with
the document id in its metadata, so deleting a document removes exactly its
chunks and leaves no orphaned vectors behind to poison later retrievals.

**Swappable models.** The backend can search Hugging Face Hub, download with
progress tracking, list what is installed and delete what is not earning its
disk space — so upgrading the model is a UI action, not a code change.

---

## Prerequisites

- Python 3.10+
- Node.js 18+
- [Ollama](https://ollama.com) installed and running (`ollama serve`)

```bash
ollama pull llama3.1:8b
ollama pull nomic-embed-text
```

## Running it

**Backend**

```bash
cd backend
python -m venv .venv
. .venv/Scripts/Activate.ps1    # PowerShell; use source .venv/bin/activate on Unix
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Health check: `curl http://localhost:8000/health`

**Frontend**

```bash
cd frontend/minette-app
npm install
npm run dev
```

## Configuration

| Variable | Default |
| --- | --- |
| `OLLAMA_BASE_URL` | `http://localhost:11434` |
| `OLLAMA_CHAT_MODEL` | `llama3.1:8b` |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` |

Vector data persists under `backend/db/`, downloaded models under
`backend/models/`. Both are gitignored.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /ingest/pdf` | Index a PDF into the vector store |
| `POST /ingest/pdf/add` | Add a PDF to an existing conversation |
| `POST /chat` | Retrieval-augmented answer |
| `POST /chat/stream` | Same, streamed token by token |
| `GET /models` | List downloaded models |
| `POST /models/search` | Search Hugging Face Hub |
| `POST /models/download` | Download a model with progress tracking |
| `DELETE /models/{id}` | Remove a downloaded model |

## Known limits

- Embeddings are generated one chunk at a time in a sequential loop — the single
  biggest ingestion bottleneck on large PDFs.
- No reranking step after retrieval.
- No citation UI tying a claim in an answer back to its source page. For a tool
  whose entire pitch is trusting the output, that is the most valuable thing left
  to build.
- Chunking leans on PDFs having real paragraph structure; dense multi-column
  academic PDFs extract with breaks in the wrong places and quality degrades.

## License

No license specified — all rights reserved.
