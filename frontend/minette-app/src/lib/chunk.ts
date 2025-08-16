// src/lib/chunk.ts

/**
 * Sentence-aware chunking with overlap.
 * Falls back to character slicing if no sentence boundaries are found.
 */
export function chunkText(
  text: string,
  chunkSize = 1200,   // characters per chunk (tune as needed)
  overlap = 200       // overlapping characters between chunks
): string[] {
  const clean = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];

  // Split on sentence enders while keeping them
  const sentences = clean.match(/[^.!?]+[.!?]+|\S+$/g) || [clean];

  const chunks: string[] = [];
  let current = "";

  for (const s of sentences) {
    // If adding this sentence would exceed the size, flush and start a new chunk
    if ((current + " " + s).trim().length > chunkSize) {
      if (current) chunks.push(current.trim());

      // Start new chunk with overlap from the previous one
      if (overlap > 0 && chunks.length > 0) {
        const prev = chunks[chunks.length - 1];
        const tail = prev.slice(Math.max(0, prev.length - overlap));
        current = (tail + " " + s).trim();
      } else {
        current = s.trim();
      }
    } else {
      current = (current + " " + s).trim();
    }
  }

  if (current) chunks.push(current.trim());

  // Safety fallback if sentence split failed weirdly
  if (chunks.length === 1 && chunks[0].length > chunkSize * 1.5) {
    return naiveCharChunks(chunks[0], chunkSize, overlap);
  }

  return chunks;
}

function naiveCharChunks(text: string, chunkSize: number, overlap: number): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    out.push(text.slice(start, end).trim());
    start += Math.max(1, chunkSize - overlap);
  }
  return out;
}
