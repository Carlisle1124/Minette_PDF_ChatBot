declare module '@huggingface/transformers' {
  export function pipeline(
    task: string,
    model?: string,
    options?: {
      device?: string;
      quantized?: boolean;
    }
  ): Promise<any>;
}