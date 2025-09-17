# Minette PDF RAG (Backend)

A minimal FastAPI backend to run local PDF RAG with Ollama + Chroma.

## Prerequisites

- Python 3.10+
- Ollama installed and running (`ollama serve`)
- Pull or have local models available:
  - Chat: `ollama pull llama3.1:8b` (or set `OLLAMA_CHAT_MODEL`)
  - Embeddings: `ollama pull nomic-embed-text` (or set `OLLAMA_EMBED_MODEL`)

## Install

```bash
cd backend
python -m venv .venv
# PowerShell
. .venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Run

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Health check:

```bash
curl http://localhost:8000/health | cat
```

## Endpoints

- POST `/ingest/pdf` (multipart file under field name `file`) → index a PDF into ChromaDB
- POST `/chat` { message, top_k? } → run retrieval-augmented generation

## Environment options

- `OLLAMA_BASE_URL` (default `http://localhost:11434`)
- `OLLAMA_CHAT_MODEL` (default `llama3.1:8b`)
- `OLLAMA_EMBED_MODEL` (default `nomic-embed-text`)

## Data persistence

ChromaDB files are stored under `backend/db/chrome_store`.
