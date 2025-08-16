// src/lib/embeddings.ts
let embeddingPipeline: any = null;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!embeddingPipeline) {
    const { pipeline } = await import("@xenova/transformers");
    embeddingPipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }

  const vectors: number[][] = [];
  for (const text of texts) {
    const result = await embeddingPipeline(text, { pooling: "mean", normalize: true });
    vectors.push(Array.from(result.data));
  }
  return vectors;
}
