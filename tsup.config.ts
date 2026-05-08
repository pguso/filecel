import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/bootstrap/cli.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022"
});

