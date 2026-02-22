import { defineConfig } from "vitest/config";
import viteTsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [viteTsConfigPaths()],
  test: {
    coverage: {
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage"
    },
  },
});
