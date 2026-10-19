import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Muss mit DEV_PROXY_PATH in src/config.ts übereinstimmen. */
const DEV_PROXY_PATH = '/n8n-webhook';

/**
 * Im Dev-Server wird der Webhook serverseitig weitergeleitet. So greift lokal keine
 * CORS-Sperre, und die App sieht die echte Antwort von n8n (z. B. HTTP 404 bei inaktivem Test-Webhook).
 */
function webhookProxy(webhookUrl: string | undefined): Record<string, ProxyOptions> | undefined {
  if (!webhookUrl) return undefined;
  let target: URL;
  try {
    target = new URL(webhookUrl);
  } catch {
    console.warn(`[ai-image-studio] VITE_N8N_WEBHOOK_URL ist keine gültige URL: ${webhookUrl}`);
    return undefined;
  }
  return {
    [DEV_PROXY_PATH]: {
      target: target.origin,
      changeOrigin: true,
      rewrite: () => target.pathname + target.search,
      // KI-Generierung kann dauern – gleiches Limit wie REQUEST_TIMEOUT_MS in src/config.ts.
      timeout: 180_000,
      proxyTimeout: 180_000,
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), tailwindcss()],
    server: { proxy: webhookProxy(env.VITE_N8N_WEBHOOK_URL?.trim()) },
  };
});
