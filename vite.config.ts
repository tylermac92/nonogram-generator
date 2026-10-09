import { playwright } from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/nonogram-generator/',
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          exclude: [...configDefaults.exclude, '**/*.browser.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        // Pre-bundled up front: discovering these mid-run reloads the page and fails the run.
        optimizeDeps: {
          include: ['react', 'react/jsx-dev-runtime', 'react-dom/client'],
        },
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            headless: true,
            // CHROMIUM_PATH lets a machine reuse an installed Chromium instead of Playwright's download.
            provider: playwright({
              launchOptions: { executablePath: process.env.CHROMIUM_PATH },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
