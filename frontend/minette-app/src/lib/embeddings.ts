import { pipeline } from '@huggingface/transformers';

let extractorPromise: Promise<any> | null = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline(
      'feature-extraction',
      'mixedbread-ai/mxbai-embed-xsmall-v1',
      { 
        device: 'cpu',  // or 'cuda' if you have NVIDIA GPU
        quantized: true // reduces memory usage
      }
    );
  }
  return extractorPromise;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();
  const output = await extractor(texts, {
    pooling: 'mean',
    normalize: true
  });
  return output.tolist(); // Convert tensor to JavaScript array
}