/// <reference types="vite/client" />
// Every Convex module, so convex-test can run the real functions in memory.
export const modules = import.meta.glob([
  "./**/*.ts",
  "./**/*.js",
  "!./**/*.test.ts",
  "!./**/*.d.ts",
  "!./test.setup.ts",
]);
