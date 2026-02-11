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

### Document Management
- POST `/ingest/pdf` (multipart file under field name `file`) → index a PDF into ChromaDB
- POST `/ingest/pdf/add` → add PDF to existing chat context
- POST `/chat` { message, top_k?, chat_id?, max_tokens? } → run retrieval-augmented generation
- POST `/chat/stream` → streaming chat responses

### Model Download Management
- GET `/models` → list all downloaded models
- GET `/models/{model_id}` → get specific model info
- POST `/models/download` { repo_id, filename, model_id? } → download from HuggingFace Hub
- DELETE `/models/{model_id}` → delete a downloaded model
- GET `/models/{model_id}/status` → get download status/progress
- POST `/models/search` { query, limit?, task? } → search HuggingFace Hub
- GET `/models/repo/{repo_id}/files` → list files in a HuggingFace repo

#### Example: Download a model
```bash
curl -X POST http://localhost:8000/models/download \
  -H "Content-Type: application/json" \
  -d '{"repo_id": "sentence-transformers/all-MiniLM-L6-v2", "filename": "pytorch_model.bin"}'
```

#### Example: Search models
```bash
curl -X POST http://localhost:8000/models/search \
  -H "Content-Type: application/json" \
  -d '{"query": "sentence transformer", "limit": 5}'
```

## Environment options

- `OLLAMA_BASE_URL` (default `http://localhost:11434`)
- `OLLAMA_CHAT_MODEL` (default `llama3.1:8b`)
- `OLLAMA_EMBED_MODEL` (default `nomic-embed-text`)

## Data persistence

- ChromaDB files are stored under `backend/db/chrome_store`
- Downloaded models are stored under `backend/models/`
