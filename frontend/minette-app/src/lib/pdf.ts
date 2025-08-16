import * as pdfjsLib from "pdfjs-dist";
import { TextItem } from "pdfjs-dist/types/src/display/api";

// Vite-specific worker setup
const workerUrl = new URL(
  "pdfjs-dist/build/pdf.worker.min.js",
  import.meta.url
).toString();
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractTextFromPdf(
  file: File
): Promise<{ text: string; pages: number }> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items
      .filter((item): item is TextItem => "str" in item)
      .map((item) => item.str);
    fullText += strings.join(" ") + "\n\n";
  }

  return { text: fullText.trim(), pages: pdf.numPages };
}