import { defineConfig } from 'vite';

// Worlds runs beside VOXELON: its own dev port, its own game-server port.
export default defineConfig({
  build: { rollupOptions: { input: { game: 'index.html', trailer: 'trailer.html' } } },
  server: { port: 5174, strictPort: true },
  preview: { port: 5174 },
});
