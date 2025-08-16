# backend/main.py
import os
import pickle
from typing import List

from fastapi import FastAPI, UploadFile, File
from pypdf import PdfReader

from sentence_transformers import SentenceTransformer
import numpy as np
import faiss

from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

app = FastAPI()

# Config
STORE_DIR = "store"
os.makedirs(STORE_DIR, exist_ok=True)
FAISS_PATH = os.path.join(STORE_DIR, "faiss.index")
DOCSTORE_PATH = os.path.join(STORE_DIR, "docstore.pkl")

# Models (loaded once)
embed_model = SentenceTransformer("all-MiniLM-L6-v2")  # small & fast
# For the LLM answer generator we use a seq2seq model for demo (e.g., FLAN-T5 small).
# You can replace with any local model you like.
tokenizer = AutoTokenizer.from_pretrained("google/flan-t5-small")
llm = AutoModelForSeq2SeqLM.from_pretrained("google/flan-t5-small")

# In-memory caches
faiss_index = None
docstore = {"chunks": [], "metas": []}  # index -> text, metadata

def save_docstore_and_index(index, docstore):
    faiss.write_index(index, FAISS_PATH)
    with open(DOCSTORE_PATH, "wb") as f:
        pickle.dump(docstore, f)

def load_docstore_and_index():
    global faiss_index, docstore
    if os.path.exists(FAISS_PATH) and os.path.exists(DOCSTORE_PATH):
        faiss_index = faiss.read_index(FAISS_PATH)
        with open(DOCSTORE_PATH, "rb") as f:
            docstore = pickle.load(f)
    else:
        faiss_index = None
        docstore = {"chunks": [], "metas": []}

def chunk_text(text: str, chunk_size=1000, overlap=200) -> List[str]:
    chunks = []
    start = 0
    L = len(text)
    while start < L:
        end = min(L, start + chunk_size)
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += chunk_size - overlap
    return chunks

@app.on_event("startup")
def startup():
    load_docstore_and_index()

@app.post("/upload")
async def upload(pdf_file: UploadFile = File(...)):
    global faiss_index, docstore

    # read PDF text
    reader = PdfReader(pdf_file.file)
    txt = ""
    for p, page in enumerate(reader.pages, start=1):
        page_text = page.extract_text() or ""
        txt += f"\n\n[page {p}]\n" + page_text

    # chunk
    chunks = chunk_text(txt, chunk_size=1000, overlap=200)
    metas = [{"source": pdf_file.filename, "page_hint": None} for _ in chunks]  # extend as needed

    # embeddings
    embeddings = embed_model.encode(chunks, convert_to_numpy=True, show_progress_bar=True)
    # normalize for cosine via inner product
    faiss.normalize_L2(embeddings)

    # create or append to index
    d = embeddings.shape[1]
    if faiss_index is None:
        # inner product on normalized vectors -> cosine similarity
        faiss_index = faiss.IndexFlatIP(d)
        faiss_index.add(embeddings)
        docstore["chunks"] = chunks
        docstore["metas"] = metas
    else:
        faiss_index.add(embeddings)
        docstore["chunks"].extend(chunks)
        docstore["metas"].extend(metas)

    save_docstore_and_index(faiss_index, docstore)
    return {"status": "ok", "chunks_added": len(chunks)}

@app.post("/ask")
async def ask(payload: dict):
    global faiss_index, docstore
    question = payload.get("query", "")
    if not question:
        return {"error": "no query provided"}

    if faiss_index is None:
        return {"error": "no documents indexed yet"}

    # embed the query
    q_emb = embed_model.encode([question], convert_to_numpy=True)
    faiss.normalize_L2(q_emb)

    k = 5
    D, I = faiss_index.search(q_emb, k)   # I shape: (1,k)
    indices = I[0].tolist()

    retrieved = []
    for idx in indices:
        if idx < len(docstore["chunks"]):
            retrieved.append(docstore["chunks"][idx])

    context = "\n\n---\n\n".join(retrieved)

    prompt = (
        "Use the context below to answer the question. If the context does not contain the answer, say you don't know.\n\n"
        f"Context:\n{context}\n\nQuestion: {question}\nAnswer:"
    )

    # tokenize & generate (be careful with max_length!)
    inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=1024)
    out = llm.generate(**inputs, max_new_tokens=256)
    answer = tokenizer.decode(out[0], skip_special_tokens=True)

    return {"answer": answer, "retrieved_chunks": retrieved}
