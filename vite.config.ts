import 'dotenv/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const serverPort = process.env.PORT ?? '3025';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.VITE_PORT ?? 5185),
    strictPort: true,
    // All interfaces, so the dev UI is reachable from the LAN
    host: '0.0.0.0',
    proxy: {
      // A regex, not the '/api' prefix: that one also catches the /api.ts module of the web app.
      // Host is kept and X-Forwarded-For added: the server checks Origin against Host and logs the real client IP
      // ws: agents connect to /api/agents/connect through this port too
      '^/api/': { target: `http://127.0.0.1:${serverPort}`, xfwd: true, ws: true },
    },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
