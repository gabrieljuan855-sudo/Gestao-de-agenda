import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    // A biblioteca de OAuth do conector importa "cloudflare:workers", que só
    // existe no runtime da Cloudflare; nos testes, um substituto mínimo
    // (worker/teste/cloudflare-workers.js). `inline` faz o vitest passar a
    // biblioteca pelo próprio resolvedor, onde o alias vale.
    alias: { 'cloudflare:workers': fileURLToPath(new URL('./worker/teste/cloudflare-workers.js', import.meta.url)) },
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
  },
})
