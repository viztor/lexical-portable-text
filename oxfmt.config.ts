import { defineConfig } from "oxfmt";

export default defineConfig({
  // Prose is hand-wrapped; keep the formatter off markdown.
  ignorePatterns: ["**/*.md"],
});
