import { defineConfig } from "vite-plus";

// Single configuration root for the whole package: staged-file checks,
// formatting, linting, type checking, tests, task caching, and the library
// build all run through `vp`.
export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    // Prose is hand-wrapped; keep the formatter off markdown.
    // `dist` is generated output, never worth reformatting.
    ignorePatterns: ["**/*.md", "dist/**"],
  },
  lint: {
    ignorePatterns: ["dist/**"],
    // Type-aware rules plus the TypeScript (tsgo) type check, so `vp check`
    // replaces a separate `tsc --noEmit` run.
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        // Test "factory bags" are plain objects of arrow functions, so
        // passing `factories.text` around never detaches a `this` binding.
        files: ["test/**"],
        rules: {
          "typescript/unbound-method": "off",
        },
      },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    // Coverage is opt-in (`vp test --coverage` / `pnpm coverage`) so the
    // default test run stays fast. Only the shipped source is measured;
    // `index.ts` is a re-export barrel and `types.ts` is type-only, so both
    // report 0% by construction rather than by missing tests.
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/types.ts"],
      // Ratchet set just below the current figures, so coverage can improve
      // freely but a regression fails the gate.
      thresholds: {
        statements: 93,
        branches: 80,
        functions: 88,
        lines: 93,
      },
    },
  },
  run: {
    // `vp run verify` caches the package.json scripts it drives. Script
    // caching is off by default; the release gate can always bypass a warm
    // cache with `vp run verify --no-cache`.
    cache: {
      scripts: true,
    },
  },
  // Library build (`vp pack`, tsdown): bundles `src/index.ts` into
  // `dist/index.js` + `dist/index.d.ts`, matching the package `exports`.
  pack: {
    entry: ["src/index.ts"],
    dts: true,
    format: ["esm"],
    sourcemap: true,
    // tsdown's node-platform default is `.mjs`; `exports` points at
    // `./dist/index.js`, so derive the extension from `"type": "module"`.
    fixedExtension: false,
  },
});
