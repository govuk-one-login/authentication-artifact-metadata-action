# Artifact Metadata Action

[![GitHub Super-Linter](https://github.com/actions/typescript-action/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/actions/typescript-action/actions/workflows/ci.yml/badge.svg)
[![Check dist/](https://github.com/actions/typescript-action/actions/workflows/check-dist.yml/badge.svg)](https://github.com/actions/typescript-action/actions/workflows/check-dist.yml)
[![CodeQL](https://github.com/actions/typescript-action/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/actions/typescript-action/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

This is for use by the auth team: it creates json metadata to be attached to
zips pushed to S3.

## Development workflow

1. Install dependencies:

   ```bash
   npm install
   ```

2. Make your changes in `src/`.

3. Run all checks locally:

   ```bash
   npm run all
   ```

   This runs formatting, linting, tests, coverage badge generation, and bundles
   the action into `dist/`.

4. Commit your changes **including `dist/`** — the bundled output must be
   checked in because GitHub Actions does not run `npm install` when consuming
   an action; it executes `dist/index.js` directly from the repository.

## Releasing changes

After your PR is merged to `main`, update the major version tag so consumers
pick up the change:

```bash
git checkout main
git pull
git tag -fa v1 -m "Update v1 tag"
git push origin v1 --force
```
