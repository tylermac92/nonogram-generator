# M1 Implementation Plan — Project Scaffold

Plan for the first user story in `docs/user-stories.md`:

> As a developer, I want a configured project that tests and deploys automatically, so that every later milestone ships to a live URL with tests guarding it.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Static host | GitHub Pages, deployed by GitHub Actions | Repo already lives on GitHub; one workflow does CI and deploy, no extra account |
| Starting point | `npm create vite@latest -- --template react-ts` | Gives React + TS + strict tsconfig + ESLint flat config for free; we only add what's missing |
| Node | 22 LTS, pinned in `.nvmrc` and CI | Matches the dev container |
| Test runner | Vitest, configured inside `vite.config.ts` | One config file; spec names Vitest |
| Formatting | Prettier + `eslint-config-prettier` | Keeps ESLint and Prettier from fighting |
| Base path | `base: '/nonogram-generator/'` in Vite config | Pages serves the site from `/<repo>/` |

## Steps

### 1. Generate the app

- Run the Vite `react-ts` template into the repo root (keep `README.md` and `docs/`).
- Delete the demo content: counter, logos, `App.css`, sample assets.
- Commit `package-lock.json`; CI uses `npm ci`.

### 2. Folder layout from the spec

```
src/
  main.tsx            # entry, mounts <App />
  ui/App.tsx          # placeholder "Nonogram Generator" heading
  core/               # framework-free TS; no React imports
    index.ts          # placeholder export, e.g. `export const VERSION = '0.0.0'`
    index.test.ts     # the placeholder test
  workers/.gitkeep    # filled in at M6
```

Sub-folders (`core/image`, `core/puzzle`, …) are created by the milestones that need them, not now.

### 3. TypeScript

- Confirm `"strict": true` in `tsconfig.app.json` and `tsconfig.node.json` (the template sets it).
- Add `"noUncheckedIndexedAccess": true`: the core is all typed-array indexing, and this catches out-of-bounds bugs early.
- Add `"types": ["vitest/globals"]` only if we use Vitest globals; otherwise import `describe/it/expect` explicitly (preferred, no config).

### 4. Vitest

- `npm i -D vitest`.
- In `vite.config.ts`: `test: { environment: 'node' }`. Core tests need no DOM; jsdom gets added at M5 when UI tests appear.
- Placeholder test in `src/core/index.test.ts` asserting the placeholder export.

### 5. ESLint and Prettier

- Keep the template's `eslint.config.js` (typescript-eslint, react-hooks, react-refresh).
- `npm i -D prettier eslint-config-prettier`; append the prettier config last in `eslint.config.js`.
- Add `.prettierrc` (`{ "singleQuote": true }` or whatever the owner prefers) and `.prettierignore` (`dist`, `coverage`).
- Add a `no-restricted-imports` rule scoped to `src/core/**` that bans `react` and `react-dom`, enforcing the "core never imports React" rule from the spec.

### 6. npm scripts

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "lint": "eslint .",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "typecheck": "tsc -b"
}
```

`test` uses `vitest run` so CI doesn't hang in watch mode.

### 7. CI and deploy workflow

One file, `.github/workflows/ci.yml`:

- **Triggers:** `push` (all branches), `pull_request`, `workflow_dispatch`.
- **Job `check`:** checkout → `actions/setup-node` (Node 22, npm cache) → `npm ci` → `npm run lint` → `npm run format:check` → `npm run typecheck` → `npm test` → `npm run build` → `actions/upload-pages-artifact` with `dist/`.
- **Job `deploy`:** `needs: check`, only `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`; permissions `pages: write`, `id-token: write`; environment `github-pages`; `actions/deploy-pages`.
- `concurrency: { group: pages, cancel-in-progress: false }` on the deploy job so two pushes don't race.

### 8. One-time repo setting (manual, owner)

Settings → Pages → Source: **GitHub Actions**. The workflow can't set this itself.

### 9. README

Replace the one-line README with: what the app is (one sentence, link to `docs/project-spec.md`), the live URL, and the scripts table from step 6.

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| `npm run dev` starts; `npm run build` produces a static bundle with no errors | Run both locally; `dist/index.html` exists; `npm run preview` loads it under `/nonogram-generator/` |
| `npm test` runs Vitest; a placeholder test passes | Run `npm test` locally and see it in the CI log |
| Lint and type-check run in CI on every push and fail the build on errors | Push a throwaway branch with a deliberate type error and an unused variable; confirm CI goes red; delete the branch |
| A push to main deploys automatically and the live URL loads | Merge to main; `deploy` job succeeds; `https://tylermac92.github.io/nonogram-generator/` shows the placeholder heading with no 404s for JS/CSS in devtools |
| TypeScript strict mode is on | `"strict": true` present in both tsconfigs; the deliberate-error branch above includes an implicit `any` that fails |

## Out of scope for M1

Routing, jsdom/React Testing Library, coverage thresholds, pre-commit hooks (husky/lint-staged), Dependabot. Add each when a later milestone needs it.

## Risks

- **Pages on a private repo** requires a paid GitHub plan. If the repo is private on a free plan, switch the host to Cloudflare Pages or Netlify (both deploy from the same `dist/`); only step 7's deploy job changes.
- **Base path:** if a custom domain is added later, `base` must change to `/`.
