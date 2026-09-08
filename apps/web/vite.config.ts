import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  build: {
    target: "es2022",
    // Vercel and Cloudflare both serve this as static files; nothing here is
    // rendered on a server.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("katex")) return "katex";
          if (id.includes("@huggingface/transformers")) return "ocr-runtime";
          return undefined;
        },
      },
    },
  },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
});
