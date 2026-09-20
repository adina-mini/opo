import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // Provide local dev support for /api/proxy
    proxy: {}
  },
  plugins: [
    {
      name: 'local-api-proxy-plugin',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url && req.url.startsWith('/api/proxy')) {
            try {
              const { default: handler } = await import('./api/proxy.js');
              await handler(req, res);
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
            return;
          }
          next();
        });
      }
    }
  ]
});
