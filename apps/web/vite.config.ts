import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  build: {
    target: "es2022",
    // Emitted to the repository root rather than apps/web, because that is
    // where a static host looks without being told. Vercel reported
    // "No Output Directory named dist found" against a vercel.json that
    // pointed at apps/web/dist, so it was not reading that setting — and a
    // project meant to be forked and deployed should not need anyone to
    // configure a dashboard field before it works.
    outDir: "../../dist",
    // Required once outDir sits outside the Vite root, or the previous build
    // is left behind and stale assets accumulate.
    emptyOutDir: true,
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
