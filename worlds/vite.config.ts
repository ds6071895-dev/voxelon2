import { defineConfig } from 'vite';

// Worlds runs beside VOXELON: its own dev port, its own game-server port.
export default defineConfig({
  server: { port: 5174, strictPort: true },
  preview: { port: 5174 },
});
