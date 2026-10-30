import { defineConfig } from "vite";

export default defineConfig({
  // Pre-bundling would move the packages away from the worker.js and ant.wasm they load by
  // new URL(..., import.meta.url).
  optimizeDeps: { exclude: ["@ant-lang/monaco", "@ant-lang/wasm"] },
  worker: { format: "es" },
});
