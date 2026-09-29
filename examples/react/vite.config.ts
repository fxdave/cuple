import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@cuple/client": path.resolve(__dirname, "../../packages/client/src/index.ts"),
      "@cuple/react": path.resolve(__dirname, "../../packages/react/src/index.ts"),
    },
  },
  server: {
    proxy: {
      "/rpc": "http://localhost:3001",
    },
  },
});
