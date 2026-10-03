import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@beyonder/benchmark": resolve(__dirname, "packages/benchmark/src/index.ts"),
      "@beyonder/compute": resolve(__dirname, "packages/compute/src/index.ts"),
      "@beyonder/runtime": resolve(__dirname, "packages/runtime/src/index.ts")
    }
  }
});
