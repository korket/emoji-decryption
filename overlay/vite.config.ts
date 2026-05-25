import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'
import fs from 'fs'
import path from 'path'

export default defineConfig({
  plugins: [
    svelte(),
    {
      name: 'serve-bgm',
      configureServer(server) {
        for (const folder of ['bgm', 'sfx']) {
          server.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith(`/${folder}/`)) return next();
            const filename = decodeURIComponent(req.url.slice(`/${folder}/`.length));
            const filePath = path.join(__dirname, '..', folder, filename);
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              res.setHeader('Content-Type', 'audio/mpeg');
              res.setHeader('Cache-Control', 'no-cache');
              fs.createReadStream(filePath).pipe(res);
            } else {
              next();
            }
          });
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../src'),
    },
  },
})
