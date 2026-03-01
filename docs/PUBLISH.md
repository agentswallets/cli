# Publish Checklist (AgentsWallets)

## Before first publish

1. Ensure npm package name is available:

```bash
npm view agentswallets
```

If already taken, rename `package.json` `name` field.

2. Login:

```bash
npm login
```

## For every release

1. Verify build and tests:

```bash
npm run build
npm test
```

2. Dry-run package:

```bash
npm run pack:check
```

3. Bump version:

```bash
npm version patch
# or npm version minor
# or npm version major
```

4. Publish:

```bash
npm publish
```

5. Smoke test in clean shell:

```bash
npm i -g agentswallets
aw --help
```

## Notes

- `prepack` already runs build automatically.
- Published binaries: `agentswallets`, `aw`.
- Keep secrets out of repo (`AGENTSWALLETS_HOME` data dir is local only).
