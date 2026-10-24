import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { fileURLToPath } from 'node:url';

const rendererSource = fileURLToPath(new URL('./src/renderer/src/', import.meta.url));

export default defineConfig({
  main: {
    // shortcut: engine 源码不热重载，修改后重启 pnpm dev；需要服务联动开发时再增加监听器。
    build: { externalizeDeps: false, rollupOptions: { output: { format: 'es' } } },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    resolve: { alias: { '@': rendererSource } },
    plugins: [
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: fileURLToPath(new URL('./src/renderer/src/routes', import.meta.url)),
        generatedRouteTree: fileURLToPath(
          new URL('./src/renderer/src/routeTree.gen.ts', import.meta.url),
        ),
      }),
      react(),
      tailwindcss(),
    ],
    server: {
      host: '127.0.0.1',
      headers: {
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; object-src 'none'; base-uri 'none'; frame-src 'none'",
      },
    },
  },
});
