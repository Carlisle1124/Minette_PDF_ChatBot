# Model Download Manager — Architecture & Integration Guide

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (React)                             │
│                                                                        │
│  ┌──────────────┐  ┌───────────────────┐  ┌─────────────────────────┐  │
│  │SettingsPanel │  │ use-models.ts     │  │ use-model-downloads.ts  │  │
│  │(model picker)│  │ (online/local)    │  │ (progress polling)      │  │
│  └──────┬───────┘  └────────┬──────────┘  └───────────┬─────────────┘  │
│         │                   │                         │                │
│         └───────────────────┼─────────────────────────┘                │
│                             ▼                                          │
│                    lib/api.ts (HTTP client)                             │
└─────────────────────────────┬──────────────────────────────────────────┘
                              │ HTTP / SSE
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         BACKEND (FastAPI)                               │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        main.py (API Layer)                      │   │
│  │  GET  /models/online           → curated + HF search           │   │
│  │  GET  /models/local            → Ollama tags + HF downloaded   │   │
│  │  POST /models/download         → start background download     │   │
│  │  GET  /models/progress/{id}    → poll progress (JSON)          │   │
│  │  GET  /models/progress/{id}/stream → SSE real-time progress    │   │
│  │  POST /models/cancel/{id}      → cancel download               │   │
│  │  GET  /models/queue            → all download tasks            │   │
│  └────────────────────────┬────────────────────────────────────────┘   │
│                           ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                   model_manager.py (Orchestrator)               │   │
│  │  • Coordinates registry + downloads + local storage             │   │
│  │  • Maintains registry.json for HF models                       │   │
│  │  • Provides unified interface for all model operations          │   │
│  └──────────┬──────────────────────────────────┬───────────────────┘   │
│             ▼                                  ▼                       │
│  ┌──────────────────────┐           ┌──────────────────────────┐       │
│  │ model_registry.py    │           │ download_manager.py      │       │
│  │ (Discovery)          │           │ (Download Engine)        │       │
│  │                      │           │                          │       │
│  │ • Curated catalog    │           │ • Async background DL    │       │
│  │ • HuggingFace search │           │ • Resume (Range header)  │       │
│  │ • HF repo file list  │           │ • Retry (exp. backoff)   │       │
│  │ • Ollama local tags  │           │ • SHA256 checksum        │       │
│  └──────────┬───────────┘           │ • Progress tracking      │       │
│             │                       │ • Concurrent queue       │       │
│             ▼                       │ • Ollama pull support    │       │
│  ┌──────────────────────┐           │ • Cancel support         │       │
│  │ HuggingFace Hub API  │           └──────┬──────────┬────────┘       │
│  │ Ollama /api/tags     │                  │          │                │
│  └──────────────────────┘                  ▼          ▼                │
│                                   ┌──────────┐  ┌──────────┐          │
│                                   │HF CDN    │  │Ollama    │          │
│                                   │(HTTP DL) │  │/api/pull │          │
│                                   └──────────┘  └──────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ./backend/models/{model-name}/
                    (HuggingFace downloaded files)
```

## 2. Folder Structure (Changes Only)

```
backend/
  download_manager.py     ← NEW: Background download engine
  model_registry.py       ← NEW: Online model discovery
  model_manager.py        ← REWRITTEN: Orchestrator (v2)
  main.py                 ← UPDATED: 4 new endpoints + supporting routes
  requirements.txt        ← NO CHANGES (all deps already present)
  models/                 ← Auto-created
    registry.json         ← Auto-created (tracks HF downloads)
    {model-name}/         ← One directory per HF model

frontend/minette-app/src/
  lib/
    api.ts                ← UPDATED: New model types + endpoint functions
  hooks/
    use-models.ts         ← UPDATED: Added online/local model support
    use-model-downloads.ts← NEW: Download progress management hook
```

## 3. API Definitions

### Core Endpoints (per spec)

| Method | Path | Description | Request | Response |
|--------|------|-------------|---------|----------|
| `GET` | `/models/online` | Browse/search available models | `?q=llama&source=huggingface&limit=20` | `{models: OnlineModel[], total}` |
| `GET` | `/models/local` | List installed models | — | `{models: LocalModel[], total}` |
| `POST` | `/models/download` | Start background download | `{source, model_name?, repo_id?, filename?}` | `{task_id, model_id, source}` |
| `GET` | `/models/progress/{task_id}` | Poll download progress | — | `DownloadProgress` |

### Supporting Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/models/cancel/{task_id}` | Cancel an active download |
| `GET` | `/models/queue` | List all download tasks |
| `GET` | `/models/progress/{task_id}/stream` | SSE real-time progress |
| `DELETE` | `/models/{model_id}` | Delete a local model |
| `POST` | `/models/search` | Search HuggingFace Hub |
| `GET` | `/models/repo/{repo_id}/files` | List files in a HF repo (with size/URL) |

### Request/Response Types

```typescript
// POST /models/download
interface DownloadRequest {
  source: "ollama" | "huggingface";
  model_name?: string;      // For Ollama (e.g. "llama3.2:1b")
  repo_id?: string;         // For HuggingFace
  filename?: string;        // For HuggingFace
  model_id?: string;        // Optional custom ID
}

// GET /models/progress/{id}
interface DownloadProgress {
  task_id: string;
  state: "queued" | "downloading" | "verifying" | "completed" | "failed" | "cancelled";
  progress_percent: number;
  downloaded_bytes: number;
  total_bytes: number;
  speed_bps: number;
  eta_seconds: number;
  error: string | null;
  attempt: number;
  max_retries: number;
  filename: string;
  model_id: string;
  source: string;
}

// GET /models/online
interface OnlineModel {
  id: string;
  name: string;
  source: "ollama" | "huggingface";
  size_label: string;
  description: string;
  tags: string[];
  installed: boolean;     // true if already available locally
}

// GET /models/local
interface LocalModel {
  id: string;
  name: string;
  source: "ollama" | "huggingface";
  size_bytes: number;
  size_label: string;
  local_path: string | null;
  family: string;
  tags: string[];
}
```

## 4. Step-by-Step Implementation Plan

### Phase 1: Backend (completed)
1. ✅ Created `backend/download_manager.py` — async download engine
2. ✅ Created `backend/model_registry.py` — model discovery + curated catalog
3. ✅ Rewrote `backend/model_manager.py` — orchestrator using both above
4. ✅ Updated `backend/main.py` — new endpoints, backward-compat preserved

### Phase 2: Frontend (completed)
5. ✅ Updated `lib/api.ts` — new types, endpoint functions, SSE helper
6. ✅ Created `hooks/use-model-downloads.ts` — progress polling hook
7. ✅ Updated `hooks/use-models.ts` — added online/local support

### Phase 3: Wiring (see Section 7 below)
8. Connect existing settings-panel model selector to live data
9. Add download buttons to model list items
10. Show progress bar during downloads
11. Refresh local model list on completion

## 5. Download Manager Features

| Feature | Implementation |
|---------|---------------|
| **Async/Background** | `asyncio.create_task` + `ThreadPoolExecutor` for blocking IO |
| **Resume** | HTTP `Range` header + `.part` file tracking |
| **Progress** | Thread-safe `DownloadProgress` dict, polled by API |
| **Retry** | Exponential backoff (5s, 10s, 20s, …, max 120s) |
| **Checksum** | SHA256 verification from HF LFS metadata |
| **Queue** | `asyncio.Semaphore(max_concurrent=2)` |
| **Cancel** | `threading.Event` checked during download loops |
| **Ollama Pull** | `/api/pull` streaming with progress extraction |

## 6. Local Storage Layout

```
backend/models/
  registry.json                    ← Tracks all HF downloads
  TheBloke__model-name__Q4_K_M/    ← One dir per HF model
    model.gguf                     ← Downloaded file
  another-model/
    weights.safetensors
```

Ollama models are stored in Ollama's own directory (managed by `ollama` CLI).

## 7. Frontend Wiring Examples

### 7a. List available models in the settings panel

```tsx
// In SettingsPanel or a new ModelBrowser component
import { useModels } from "@/hooks/use-models";
import { useEffect } from "react";

function ModelSelector() {
  const { onlineModels, localModels, refreshOnlineModels, refreshLocalModels } = useModels();

  useEffect(() => {
    refreshOnlineModels();   // Load curated catalog
    refreshLocalModels();    // Load installed models
  }, []);

  return (
    <div>
      <h3>Installed Models ({localModels.length})</h3>
      {localModels.map(m => (
        <div key={m.id}>
          {m.name} ({m.size_label}) — {m.source}
        </div>
      ))}

      <h3>Available for Download</h3>
      {onlineModels.filter(m => !m.installed).map(m => (
        <div key={m.id}>
          {m.name} ({m.size_label})
          <button onClick={() => handleDownload(m)}>Download</button>
        </div>
      ))}
    </div>
  );
}
```

### 7b. Start a download and track progress

```tsx
import { useModelDownloads } from "@/hooks/use-model-downloads";

function DownloadSection() {
  const { downloads, startDownload, cancelDownload, isDownloading } = useModelDownloads();

  const handleDownloadOllama = async (modelName: string) => {
    await startDownload({ source: "ollama", model_name: modelName });
  };

  const handleDownloadHF = async (repoId: string, filename: string) => {
    await startDownload({ source: "huggingface", repo_id: repoId, filename });
  };

  return (
    <div>
      {downloads.map(d => (
        <div key={d.task_id}>
          <span>{d.filename}: {d.state}</span>
          <progress value={d.progress_percent} max={100} />
          <span>{d.progress_percent.toFixed(1)}%</span>
          {d.speed_bps > 0 && (
            <span>{(d.speed_bps / 1024 / 1024).toFixed(1)} MB/s</span>
          )}
          {d.eta_seconds > 0 && (
            <span>ETA: {Math.ceil(d.eta_seconds)}s</span>
          )}
          {["queued", "downloading"].includes(d.state) && (
            <button onClick={() => cancelDownload(d.task_id)}>Cancel</button>
          )}
          {d.error && <span className="text-red-500">{d.error}</span>}
        </div>
      ))}
    </div>
  );
}
```

### 7c. Wire download to existing model selector button

```tsx
// In settings-panel.tsx, connect to the existing model list
import { useModelDownloads } from "@/hooks/use-model-downloads";

// Inside SettingsPanel component:
const { startDownload, downloads, isDownloading } = useModelDownloads();

// When user selects a model that isn't installed yet:
const handleModelSelect = async (modelId: string) => {
  setSelectedModel(modelId);

  // Check if model needs download (Ollama pull)
  const taskId = await startDownload({
    source: "ollama",
    model_name: modelId,
  });

  if (taskId) {
    // Toast notification
    toast({ title: `Downloading ${modelId}...`, description: "Check progress in downloads" });
  }
};
```

### 7d. SSE real-time progress (alternative to polling)

```tsx
import { streamDownloadProgress } from "@/lib/api";

// After starting a download:
const cleanup = streamDownloadProgress(
  taskId,
  (progress) => {
    // Update UI with real-time progress
    setProgress(progress.progress_percent);
    setSpeed(progress.speed_bps);
  },
  () => {
    // Download finished
    refreshLocalModels();
    toast({ title: "Download complete!" });
  },
  (err) => {
    toast({ title: "Download error", description: err, variant: "destructive" });
  },
);

// Cleanup on unmount
useEffect(() => cleanup, []);
```

### 7e. Refresh models after download completes

```tsx
import { useModels } from "@/hooks/use-models";
import { useModelDownloads } from "@/hooks/use-model-downloads";

function ModelManager() {
  const { localModels, refreshLocalModels, refreshOnlineModels } = useModels();
  const { downloads } = useModelDownloads();

  // Auto-refresh when a download completes
  useEffect(() => {
    const justCompleted = downloads.some(d => d.state === "completed");
    if (justCompleted) {
      refreshLocalModels();
      refreshOnlineModels(); // Updates "installed" flags
    }
  }, [downloads]);
}
```

### 7f. Error handling

```tsx
const { startDownload, error } = useModelDownloads();

const handleDownload = async () => {
  const taskId = await startDownload({ source: "ollama", model_name: "llama3.2:1b" });
  if (!taskId) {
    // startDownload returns null on error, `error` state is set
    toast({ title: "Failed to start download", description: error, variant: "destructive" });
  }
};
```

## 8. Minimal Changes Strategy

| File | Change Type | Lines Changed |
|------|------------|---------------|
| `backend/download_manager.py` | **NEW** | ~300 lines |
| `backend/model_registry.py` | **NEW** | ~280 lines |
| `backend/model_manager.py` | **REWRITE** | ~250 lines (was 378) |
| `backend/main.py` | **UPDATE** | ~150 lines replaced, rest untouched |
| `frontend/src/lib/api.ts` | **UPDATE** | Model section rewritten (~200 lines) |
| `frontend/src/hooks/use-models.ts` | **UPDATE** | Added online/local (~40 lines added) |
| `frontend/src/hooks/use-model-downloads.ts` | **NEW** | ~170 lines |
| `backend/requirements.txt` | **NO CHANGE** | — |
| All other files | **NO CHANGE** | — |

**Zero UI rewrites.** All existing components (Chat, DocumentUploader, ChatHistorySidebar, SettingsPanel) are untouched. The new hooks can be wired into existing components with minimal additions.

## 9. Testing Checklist

### Backend API Tests

- [ ] `GET /models/online` → returns curated list with `installed` flags
- [ ] `GET /models/online?q=llama&source=huggingface` → returns HF search results
- [ ] `GET /models/local` → returns Ollama models + HF registry entries
- [ ] `POST /models/download` with `{source: "ollama", model_name: "tinyllama:1.1b"}` → returns `task_id`
- [ ] `POST /models/download` with `{source: "huggingface", repo_id: "...", filename: "..."}` → returns `task_id`
- [ ] `GET /models/progress/{task_id}` → returns progress during download
- [ ] `GET /models/progress/{task_id}` → returns `state: "completed"` after finish
- [ ] `POST /models/cancel/{task_id}` → cancels in-progress download
- [ ] `GET /models/queue` → lists all tasks
- [ ] `DELETE /models/{model_id}` → removes model + files
- [ ] `POST /models/search` → searches HuggingFace (backward compat)
- [ ] `GET /models/repo/{id}/files` → lists repo files with sizes

### Download Manager Tests

- [ ] Concurrent downloads respect `max_concurrent=2` limit
- [ ] Partial download resumes correctly (kill + restart)
- [ ] Retry triggers on connection timeout (3 retries, exponential backoff)
- [ ] SHA256 checksum rejects corrupt downloads
- [ ] Cancel stops download and marks state as `cancelled`
- [ ] Ollama pull tracks layered progress correctly
- [ ] Speed and ETA calculations are reasonable

### Frontend Integration Tests

- [ ] `useModels().refreshOnlineModels()` populates `onlineModels`
- [ ] `useModels().refreshLocalModels()` populates `localModels`
- [ ] `useModelDownloads().startDownload()` returns task_id
- [ ] Progress bar updates via polling every 800ms
- [ ] Cancel button calls `cancelDownload()` and updates UI
- [ ] Completed download triggers local model list refresh
- [ ] SSE stream (`streamDownloadProgress`) works for real-time updates
- [ ] Error states display correctly

### Edge Cases

- [ ] Offline: `/models/online` returns curated list (no crash)
- [ ] Ollama down: `/models/local` returns HF models only (graceful)
- [ ] HuggingFace unreachable: search returns empty (no crash)
- [ ] Double-download: same model returns existing download's task_id
- [ ] Large file (>4GB): progress tracking works correctly
- [ ] Disk full: download fails with clear error message

### Cross-Platform

- [ ] Windows: paths use correct separators
- [ ] macOS/Linux: file permissions are correct
- [ ] All path operations use `pathlib.Path` or `os.path`

## 10. Quick Start (Development)

```bash
# Backend is already running via tasks.json
# Test the new endpoints:

# 1. Browse available models
curl http://localhost:8000/models/online

# 2. Check installed models
curl http://localhost:8000/models/local

# 3. Start an Ollama download
curl -X POST http://localhost:8000/models/download \
  -H "Content-Type: application/json" \
  -d '{"source": "ollama", "model_name": "tinyllama:1.1b"}'
# → {"task_id": "abc123", "model_id": "tinyllama:1.1b", "source": "ollama"}

# 4. Check progress
curl http://localhost:8000/models/progress/abc123
# → {"state": "downloading", "progress_percent": 45.2, ...}

# 5. Search HuggingFace
curl http://localhost:8000/models/online?q=gguf+llama&source=huggingface

# 6. Cancel
curl -X POST http://localhost:8000/models/cancel/abc123
```
