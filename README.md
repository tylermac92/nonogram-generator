# Nonogram Generator

A client-side web app that turns an image into a black-and-white nonogram that can be solved by logic alone. See [`docs/project-spec.md`](docs/project-spec.md) and [`docs/user-stories.md`](docs/user-stories.md).

Live: https://tylermac92.github.io/nonogram-generator/

## Development

Requires Node 22 (see `.nvmrc`).

| Command                | What it does                           |
| ---------------------- | -------------------------------------- |
| `npm run dev`          | Start the dev server                   |
| `npm run build`        | Type-check and build the static bundle |
| `npm run preview`      | Serve the built bundle locally         |
| `npm test`             | Run the Vitest suite once              |
| `npm run test:watch`   | Run Vitest in watch mode               |
| `npm run lint`         | ESLint                                 |
| `npm run format`       | Format with Prettier                   |
| `npm run format:check` | Check formatting without writing       |
| `npm run typecheck`    | Type-check only                        |

`npm test` runs Node unit tests and browser tests (`*.browser.test.ts`) in headless Chromium. Install the browser once with `npx playwright install chromium`, or point at an existing one with `CHROMIUM_PATH=/path/to/chrome npm test`.

Pushes to `main` deploy to GitHub Pages after CI passes.
