export interface ChunkOptions {
  maxChars?: number;
  overlap?: number;
}

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? 900;
  const overlap = options.overlap ?? 120;

  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + maxChars, cleaned.length);

    if (end < cleaned.length) {
      // Try to cut at sentence boundary
      const periodIdx = cleaned.lastIndexOf(".", end);
      if (periodIdx > start + maxChars * 0.6) {
        end = periodIdx + 1;
      }
    }

    const chunk = cleaned.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);

    if (end === cleaned.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}
