import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Prefer shared source during local dev so catalog/nav changes apply without a stale dist.
      "@bms/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts")
    }
  },
  server: {
    port: 5174,
    fs: {
      allow: [path.resolve(__dirname, "../..")]
    }
  },
  optimizeDeps: {
    exclude: ["@bms/shared"]
  }
});
