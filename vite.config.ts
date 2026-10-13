import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false,
    host: true,
    // While developing, the game server (npm run play) answers the phones' websocket and /info.
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
      '/info': 'http://127.0.0.1:8080',
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), controller: fileURLToPath(new URL('./controller.html', import.meta.url)) } },
  },
});
