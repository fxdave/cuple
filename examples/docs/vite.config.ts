import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@cuple/client": path.resolve(__dirname, "../../packages/client/src/index.ts"),
      "@cuple/react": path.resolve(__dirname, "../../packages/react/src/index.ts"),
    },
  },
  // Each `dev:*` script passes its example's folder as the root; tests live in all of them.
  test: { dir: __dirname },
  server: {
    proxy: { "/rpc": "http://localhost:3002" },
  },
});
