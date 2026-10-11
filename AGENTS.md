# Repository guide

This package is built and checked entirely with [Vite+](https://viteplus.dev).
There is no separate `tsc` / `vitest` / `oxlint` / `oxfmt` setup: `vite.config.ts`
is the single config root (`staged`, `fmt`, `lint`, `test`, `run`, `pack`
blocks) and the `vp` CLI runs everything.

## Before you start

```bash
vp install
```

Requires Node 24.11+ (or 26+), which `package.json` `engines` encodes. Vite+
1.0.0 itself supports `^22.18.0 || ^24.11.0 || >=26.0.0`, so the Node 25 line
is outside the supported range even though it is numerically newer.

## Validate changes

```bash
vp check            # format + lint + type check (tsgo) in one pass
vp test             # Vitest suite (14 files, 305 tests)
vp test --coverage  # same suite plus src/ coverage; thresholds are enforced
vp pack             # build dist/ (tsdown: ESM + .d.ts + sourcemap)
vp run verify       # check + test + pack — the release gate, also prepublishOnly
```

`vp run verify` caches the scripts it drives once a run succeeds. The cache
invalidates on source changes and never masks a failing test; force the full
gate with `vp run verify --no-cache`.

## Commit hooks

`.vite-hooks/pre-commit` runs `vp staged`, which applies the `staged` block in
`vite.config.ts` (`vp check --fix` over the staged files). The dispatcher under
`.vite-hooks/_` is generated: it ignores itself and is recreated by
`vp config`, which the `prepare` script runs on install. Skip hooks for one
commit with `VP_GIT_HOOKS=0 git commit …`.

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
- Coverage measures `src/**` minus `index.ts` (re-export barrel) and `types.ts`
  (type-only). The thresholds in `vite.config.ts` are a ratchet: raise them as
  coverage improves, and add tests rather than lowering them.
- CI uses `voidzero-dev/setup-vp` (exact version pinned in
  `.github/workflows/*.yml`); keep that pin updated when bumping `vite-plus`.
