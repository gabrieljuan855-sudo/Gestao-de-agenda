// Autenticação client-side usando Google Identity Services (GIS).
// Não usa backend: o token de acesso fica só no navegador do usuário.

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  // Sem este escopo o token não carrega e-mail, e a rota /api/parse não
  // consegue confirmar que quem chamou é o dono da conta.
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const STORAGE_KEY = 'gestao-agenda:token'
// Renova um pouco antes de expirar para nenhuma chamada sair com token vencido.
const EXPIRY_MARGIN_MS = 60 * 1000

let tokenClient = null
let currentToken = null
let expiresAt = 0
let onTokenChange = () => {}
let pendingRefresh = null
let resolvePendingRefresh = null

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: currentToken, expiresAt }))
  } catch {
    // Sem permissão para guardar: a sessão continua valendo só nesta aba.
  }
}

function readPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.token || Date.now() >= parsed.expiresAt - EXPIRY_MARGIN_MS) return null
    return parsed
  } catch {
    return null
  }
}

function clearPersisted() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nada a fazer: o token em memória já foi descartado.
  }
}

function settleRefresh(token) {
  if (resolvePendingRefresh) resolvePendingRefresh(token)
  pendingRefresh = null
  resolvePendingRefresh = null
}

export function initGoogleAuth(callback) {
  onTokenChange = callback
  if (!window.google || !CLIENT_ID) return

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (response) => {
      if (response && response.access_token) {
        currentToken = response.access_token
        expiresAt = Date.now() + Number(response.expires_in || 3600) * 1000
        persist()
        onTokenChange(currentToken)
        settleRefresh(currentToken)
      } else {
        settleRefresh(null)
      }
    },
    error_callback: () => {
      // Renovação silenciosa não rolou (sessão do Google caiu, pop-up bloqueado):
      // cai no botão de entrar em vez de travar esperando.
      settleRefresh(null)
    },
  })

  const stored = readPersisted()
  if (stored) {
    currentToken = stored.token
    expiresAt = stored.expiresAt
    onTokenChange(currentToken)
    return
  }

  // Já houve consentimento antes: tenta renovar sem mostrar nada ao usuário.
  if (localStorage.getItem(STORAGE_KEY) !== null) {
    clearPersisted()
    requestSilently()
  }
}

function requestSilently() {
  if (!tokenClient) return Promise.resolve(null)
  if (pendingRefresh) return pendingRefresh
  pendingRefresh = new Promise((resolve) => {
    resolvePendingRefresh = resolve
  })
  try {
    tokenClient.requestAccessToken({ prompt: '' })
  } catch {
    settleRefresh(null)
  }
  return pendingRefresh
}

export function signIn() {
  if (!tokenClient) {
    alert('Configuração do Google ainda não carregou. Veja o README para configurar VITE_GOOGLE_CLIENT_ID.')
    return
  }
  tokenClient.requestAccessToken()
}

export function signOut() {
  if (currentToken && window.google) {
    window.google.accounts.oauth2.revoke(currentToken, () => {})
  }
  currentToken = null
  expiresAt = 0
  clearPersisted()
  onTokenChange(null)
}

export function getToken() {
  if (currentToken && Date.now() >= expiresAt - EXPIRY_MARGIN_MS) return null
  return currentToken
}

// Devolve um token válido, renovando em silêncio se o atual estiver vencendo.
export async function ensureToken() {
  const valid = getToken()
  if (valid) return valid

  const renewed = await requestSilently()
  if (!renewed) {
    currentToken = null
    expiresAt = 0
    clearPersisted()
    onTokenChange(null)
  }
  return renewed
}

export function isConfigured() {
  return Boolean(CLIENT_ID)
}
