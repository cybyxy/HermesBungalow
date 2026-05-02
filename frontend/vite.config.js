import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
/** Keep browser Host (e.g. localhost:3000) so Hermes _check_csrf matches Origin. */
var backendProxy = {
    target: 'http://127.0.0.1:8000',
    changeOrigin: false,
    configure: function (proxy) {
        proxy.on('proxyRes', function (proxyRes) {
            var ct = proxyRes.headers['content-type'];
            if (typeof ct === 'string' && ct.indexOf('text/event-stream') !== -1) {
                proxyRes.headers['x-accel-buffering'] = 'no';
                proxyRes.headers['cache-control'] = 'no-cache';
            }
        });
    },
};
export default defineConfig({
    plugins: [react()],
    server: {
        host: '0.0.0.0',
        port: 3000,
        strictPort: true,
        proxy: {
            '/api': backendProxy,
            // WebSocket: client uses direct ws://<host>:8000 in dev (see gameGateway.ts) to avoid proxy EPIPE noise.
        },
    },
});
