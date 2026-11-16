import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { devApi } from './scripts/devApiPlugin.ts';

export default defineConfig({
  plugins: [
    react(),
    // Sert /api/ai en développement et en prévisualisation (même code que la fonction Vercel).
    devApi(),
    // Application installable et utilisable hors ligne (la cave est locale).
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      includeAssets: ['icons/*.png', 'icons/*.svg', 'apple-touch-icon.png', 'exemple-cave.csv', 'cave-bacchus.csv'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    testTimeout: 20_000,
  },
});
