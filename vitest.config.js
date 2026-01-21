import { defineConfig } from "vitest/config";
import viteTsConfigPaths from "vite-tsconfig-paths";
import path from "path";

export default defineConfig({
  plugins: [viteTsConfigPaths()],
  test: {
    coverage: {
      reporter: ["text", "json", "html"],
      include: "packages/*/dist",
    },
  },
});
