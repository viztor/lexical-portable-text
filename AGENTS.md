# Repository guide

This package is built and checked entirely with [Vite+](https://viteplus.dev).
There is no separate `tsc` / `vitest` / `oxlint` / `oxfmt` setup: `vite.config.ts`
is the single config root (`fmt`, `lint`, `test`, `pack` blocks) and the `vp`
CLI runs everything.

## Before you start

```bash
vp install
```

## Validate changes

```bash
vp check       # format + lint + type check (tsgo) in one pass
vp test        # Vitest suite (14 files, 305 tests)
vp pack        # build dist/ (tsdown: ESM + .d.ts + sourcemap)
vp run verify  # check + test + pack — the release gate, also prepublishOnly
```

## Conventions

- `package.json` scripts are thin wrappers over the same commands, so
  `pnpm verify`, `pnpm test`, etc. keep working — but prefer calling `vp`
  directly.
- Type errors fail `vp check`: `lint.options.typeCheck` runs the TypeScript
  (tsgo) check as part of the lint pass, so `typecheck` is
  `vp check --no-fmt --no-lint`.
- Test files import from `vite-plus/test` (`describe`, `it`, `expect`, `vi`) —
  not from `vitest` directly.
- Formatting ignores `**/*.md`: prose in `README.md` is hand-wrapped, so
  `vp fmt` must not touch it.
- CI uses `voidzero-dev/setup-vp` (exact version pinned in
  `.github/workflows/*.yml`); keep that pin updated when bumping `vite-plus`.
