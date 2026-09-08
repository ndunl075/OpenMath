import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@openmath/math-core": new URL("./packages/math-core/src/index.ts", import.meta.url).pathname,
      "@openmath/steps": new URL("./packages/steps/src/index.ts", import.meta.url).pathname,
      "@openmath/step-motion": new URL("./packages/step-motion/src/index.ts", import.meta.url).pathname,
      "@openmath/ocr": new URL("./packages/ocr/src/index.ts", import.meta.url).pathname,
      "@openmath/corpus": new URL("./packages/corpus/src/index.ts", import.meta.url).pathname,
    },
  },
});
