import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { loadEnv } from "vite";

// e2e tests must use the separate *_test database, never the dev one.
const env = loadEnv("test", process.cwd(), "");

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: "./",
    include: ["**/*.e2e-spec.ts"],
    env: { DATABASE_URL: env.DATABASE_URL_TEST },
    // One file at a time: the files share the test database and empty its tables, so running them in
    // parallel would let one file wipe another's rows mid-test.
    fileParallelism: false,
  },
});
