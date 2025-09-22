# Tasks: PDF ChatBot

**Input**: Design documents from `/specs/001-pdf-chatbot/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/

## Phase 3.1: Setup

- [x] T001 Create project structure per implementation plan
- [x] T002 Initialize Python backend with FastAPI dependencies
- [x] T003 Initialize React frontend with TypeScript and Vite
- [x] T004 [P] Configure linting and formatting tools (black, flake8, ESLint)

## Phase 3.2: Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.3

**CRITICAL: These tests MUST be written and MUST FAIL before ANY implementation**

- [x] T005 [P] Contract test POST /ingest/pdf in tests/test_ingest_pdf.py
- [x] T006 [P] Contract test POST /chat in tests/test_chat.py
- [x] T007 [P] Integration test document upload flow in tests/test_document_upload.py
- [x] T008 [P] Integration test RAG pipeline in tests/test_rag_pipeline.py

## Phase 3.3: Core Implementation (ONLY after tests are failing)

- [x] T009 [P] PDF text extraction utility in backend/utils/pdf_extractor.py
- [x] T010 [P] Text chunking utility in backend/utils/chunker.py
- [x] T011 [P] Embedding service in backend/utils/embedder.py
- [x] T012 [P] Ollama client in backend/utils/ollama_client.py
- [x] T013 [P] ChromaDB integration in backend/utils/vector_store.py
- [x] T014 [P] RAG pipeline orchestration in backend/rag_pipeline.py
- [x] T015 [P] FastAPI endpoints in backend/main.py
- [x] T016 [P] Document upload component in frontend/src/components/DocumentUpload.tsx
- [x] T017 [P] Chat interface component in frontend/src/components/ChatInterface.tsx
- [x] T018 [P] Message display component in frontend/src/components/MessageList.tsx
- [x] T019 [P] API integration service in frontend/src/services/api.ts
- [x] T020 Main App component integration in frontend/src/App.tsx

## Phase 3.4: Integration

- [x] T021 Connect frontend to backend API
- [x] T022 Error handling and user feedback
- [x] T023 File upload progress indicators
- [x] T024 Response streaming for chat messages

## Phase 3.5: Polish

- [x] T025 [P] Unit tests for text chunking in tests/unit/test_chunker.py
- [x] T026 [P] Unit tests for embedding generation in tests/unit/test_embedder.py
- [x] T027 Performance tests (<30s document processing, <5s query response)
- [x] T028 [P] Update README.md with setup and usage instructions
- [x] T029 UI/UX improvements and responsive design
- [x] T030 Code documentation and type hints completion

## Dependencies

- Tests (T005-T008) before implementation (T009-T020)
- T009-T013 blocks T014
- T014 blocks T015
- T016-T019 blocks T021
- Implementation before polish (T025-T030)

## Notes

- [P] tasks = different files, no dependencies
- All core functionality implemented and tested
- System runs locally with Ollama and ChromaDB
- Frontend provides clean chat interface for document Q&A
