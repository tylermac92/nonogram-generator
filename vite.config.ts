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
          exclude: [...configDefaults.exclude, '**/*.browser.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
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
