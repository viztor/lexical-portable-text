import { defineConfig } from "vite-plus";

// Single configuration root for the whole package: format, lint, type check,
// test, and the library build all run through `vp`.
export default defineConfig({
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
