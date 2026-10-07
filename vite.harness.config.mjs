import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
const mock = '/tmp/claude-0/-home-user-Gestao-de-agenda/305a5f5b-d936-5614-bd0f-24aac3d2b855/scratchpad/harness/googleAuthMock.js'
export default defineConfig({
  root: '/home/user/Gestao-de-agenda',
  plugins: [react(), { name: 'mock-auth', enforce: 'pre', resolveId(id) { if (id.endsWith('googleAuth.js')) return mock } }],
  server: { fs: { allow: ['/home/user/Gestao-de-agenda', '/tmp/claude-0/-home-user-Gestao-de-agenda/305a5f5b-d936-5614-bd0f-24aac3d2b855/scratchpad'] } },
})
