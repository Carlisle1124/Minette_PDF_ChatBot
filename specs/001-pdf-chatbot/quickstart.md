# Quick Start Guide: PDF ChatBot

## Prerequisites

- Python 3.10 or higher
- Node.js 18 or higher
- Ollama installed and running

## Installation

### 1. Clone and Setup Backend

```bash
cd backend
python -m venv .venv
# Windows PowerShell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Setup Frontend

```bash
cd ../frontend/minette-app
npm install
```

### 3. Install Ollama Models

```bash
ollama pull llama3.1:8b
ollama pull nomic-embed-text
ollama serve
```

## Running the Application

### Start Backend

```bash
cd backend
.venv\Scripts\Activate.ps1
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Start Frontend

```bash
cd frontend/minette-app
npm run dev
```

## Usage

1. Open http://localhost:5173 in your browser
2. Upload a PDF document using the upload interface
3. Ask questions about the document content in the chat
4. Get AI-powered answers based on the document

## API Endpoints

- `POST /ingest/pdf` - Upload and process PDF documents
- `POST /chat` - Send questions and get responses
- `GET /health` - Health check endpoint

## Troubleshooting

- Ensure Ollama is running: `ollama serve`
- Check Python environment is activated
- Verify all dependencies are installed
- Check console for error messages
