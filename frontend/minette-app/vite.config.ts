import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import type { PluginOption } from "vite";

export default defineConfig({
  plugins: [react() as PluginOption], // Explicit type assertion
  
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },

  server: {
    host: "::",
    port: 8080,
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          pdfjs: ["pdfjs-dist"],
        },
      },
    },
  },
});