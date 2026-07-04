import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "tests/integration/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/bootstrap/cli.ts",
        "src/bootstrap/cloudflare.ts",
        "src/index.ts",
        "src/types.ts",
        "src/transform/loadDeps.ts",
        "src/transform/image/**",
        "src/transform/video/**"
      ],
      thresholds: {
        lines: 82,
        functions: 85,
        branches: 76,
        statements: 82
      }
    }
  }
});
