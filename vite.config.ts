import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/nonogram-generator/',
  plugins: [react()],
  test: { environment: 'node' },
});
