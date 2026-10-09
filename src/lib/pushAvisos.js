import { ensureToken } from './googleAuth.js'

// Inscrição deste aparelho nos avisos com o app fechado (Web Push). Ver
// worker/avisos.js para o lado do servidor.

export function pushSuportado() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function ehIOS() {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

// No iPhone, o push só existe no app aberto pela Tela de Início, não no
// Safari — é a regra da Apple. Serve para dizer à pessoa o que fazer.
export function abertoComoApp() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
}

function bytesDaChave(base64url) {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((base64url.length + 3) % 4)
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

async function chamar(caminho, opcoes = {}) {
  const token = await ensureToken()
  if (!token) throw new Error('Faça login primeiro.')
  const res = await fetch(caminho, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opcoes.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `O servidor respondeu ${res.status}.`)
  return data
}

export async function inscricaoAtual() {
  if (!pushSuportado()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) || null
}

// Pede ao navegador uma inscrição de push com a chave do servidor. No
// iPhone precisa vir de um toque da pessoa — por isso existe um botão.
export async function inscreverNesteAparelho() {
  const { publica } = await chamar('/api/avisos/chave')
  const reg = await navigator.serviceWorker.ready
  const atual = await reg.pushManager.getSubscription()
  if (atual) return atual
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesDaChave(publica) })
}

export async function enviarAvisos(inscricao, avisos) {
  return chamar('/api/avisos', {
    method: 'POST',
    body: JSON.stringify({ inscricao: inscricao.toJSON(), avisos }),
  })
}

export async function cancelarNesteAparelho() {
  const inscricao = await inscricaoAtual()
  if (!inscricao) return
  await chamar('/api/avisos', { method: 'POST', body: JSON.stringify({ cancelar: inscricao.endpoint }) }).catch(() => {})
  await inscricao.unsubscribe()
}
