export interface StoredDoc {
  id: string;
  text: string;
  metadata?: Record<string, any>;
  embedding: number[];
}

function cosine(a: number[], b: number[]) {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

class VectorStore {
  private docs: StoredDoc[] = [];

  get size() {
    return this.docs.length;
  }

  add(docs: Omit<StoredDoc, "id">[]) {
    const withIds = docs.map((d) => ({ ...d, id: crypto.randomUUID() }));
    this.docs.push(...withIds);
  }

  searchByVector(query: number[], k = 5) {
    const scored = this.docs.map((d) => ({ doc: d, score: cosine(query, d.embedding) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  // New: remove all chunks for a given source (e.g., a specific PDF filename)
  removeBySource(source: string) {
    this.docs = this.docs.filter((d) => d.metadata?.source !== source);
  }

  // New: get counts per source to display and manage uploaded PDFs
  countsBySource() {
    const map = new Map<string, number>();
    for (const d of this.docs) {
      const s = d.metadata?.source ?? "unknown";
      map.set(s, (map.get(s) || 0) + 1);
    }
    return Array.from(map.entries()).map(([source, count]) => ({ source, count }));
  }
}

export const vectorStore = new VectorStore();
