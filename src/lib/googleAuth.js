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
const GIS_SRC = 'https://accounts.google.com/gsi/client'
// Renova um pouco antes de expirar para nenhuma chamada sair com token vencido.
const EXPIRY_MARGIN_MS = 60 * 1000
// Enquanto o app está aberto, renova bem antes disso: assim a troca acontece
// no silêncio, e não no meio de uma chamada que o usuário está esperando.
const RENEW_MARGIN_MS = 5 * 60 * 1000
// Quanto esperar o script do Google antes de oferecer "tentar de novo".
const GIS_TIMEOUT_MS = 12 * 1000
// Em rede de celular o script cai com frequência; uma reinjeção resolve.
const GIS_RETRY_MS = 3000

let tokenClient = null
let currentToken = null
let expiresAt = 0
let onTokenChange = () => {}
let onStatusChange = () => {}
let pendingRefresh = null
let resolvePendingRefresh = null
let renewTimer = null
let gisReady = null
let injected = false
let watching = false
let lateWatcher = null

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

function hadSession() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    return false
  }
}

function clearPersisted() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nada a fazer: o token em memória já foi descartado.
  }
}

// ---------- carregamento do script do Google ----------

function gisLoaded() {
  return Boolean(window.google?.accounts?.oauth2)
}

// O index.html pede o script com async/defer, então ele quase sempre chega
// *depois* da tela aparecer — principalmente no celular. Em vez de desistir
// nesse instante (era o que fazia o app cair na tela de login e reclamar de
// configuração), espera ele chegar, e pede de novo se demorar demais.
function whenGisReady() {
  if (gisLoaded()) return Promise.resolve(true)
  if (gisReady) return gisReady

  gisReady = new Promise((resolve) => {
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(retry)
      clearTimeout(giveUp)
      // Falhou: esquece a promessa para que uma tentativa futura (voltar a ter
      // rede, tocar em "tentar de novo") recomece do zero em vez de herdar o não.
      if (!ok) gisReady = null
      resolve(ok)
    }

    // Checar de tempos em tempos cobre tanto o script ainda em trânsito quanto
    // o que terminou sem disparar "load" (cache, bfcache, volta de segundo plano).
    const poll = setInterval(() => {
      if (gisLoaded()) finish(true)
    }, 150)
    const retry = setTimeout(() => {
      if (!gisLoaded()) injectGis()
    }, GIS_RETRY_MS)
    const giveUp = setTimeout(() => finish(gisLoaded()), GIS_TIMEOUT_MS)
  })

  return gisReady
}

function injectGis() {
  if (injected) return
  injected = true
  const script = document.createElement('script')
  script.src = GIS_SRC
  script.async = true
  document.head.appendChild(script)
}

// Desistimos de esperar, mas o script ainda pode chegar (rede voltou, aba
// saiu do segundo plano). Se chegar, o login libera sozinho, sem o usuário
// precisar tocar em "tentar de novo".
function watchLateGis() {
  if (lateWatcher) return
  lateWatcher = setInterval(() => {
    if (!gisLoaded()) return
    clearInterval(lateWatcher)
    lateWatcher = null
    becomeReady()
  }, 1000)
}

function becomeReady() {
  createTokenClient()
  if (!tokenClient) return false
  if (lateWatcher) {
    clearInterval(lateWatcher)
    lateWatcher = null
  }
  onStatusChange('ready')
  watchReturn()
  return true
}

function createTokenClient() {
  if (tokenClient || !gisLoaded() || !CLIENT_ID) return
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (response) => {
      if (response && response.access_token) {
        currentToken = response.access_token
        expiresAt = Date.now() + Number(response.expires_in || 3600) * 1000
        persist()
        scheduleRenewal()
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
}

// ---------- renovação ----------

function settleRefresh(token) {
  if (resolvePendingRefresh) resolvePendingRefresh(token)
  pendingRefresh = null
  resolvePendingRefresh = null
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

function forgetSession() {
  clearTimeout(renewTimer)
  renewTimer = null
  currentToken = null
  expiresAt = 0
  clearPersisted()
  onTokenChange(null)
}

async function renew() {
  const token = await requestSilently()
  if (token) return token
  // Sem rede não dá para saber se a sessão caiu de verdade: manter o que está
  // guardado e tentar de novo depois é melhor do que mandar o usuário logar
  // outra vez por causa de um sinal ruim.
  if (navigator.onLine === false) return null
  forgetSession()
  return null
}

function scheduleRenewal() {
  clearTimeout(renewTimer)
  renewTimer = null
  if (!currentToken) return
  const delay = Math.max(expiresAt - Date.now() - RENEW_MARGIN_MS, 1000)
  renewTimer = setTimeout(renew, delay)
}

// Timer de aba em segundo plano é estrangulado pelo navegador, e no celular a
// página costuma ser congelada inteira. Então, toda vez que o app volta ao
// primeiro plano ou a rede volta, confere se o token ainda serve.
function refreshOnReturn() {
  if (!currentToken) return
  if (Date.now() < expiresAt - RENEW_MARGIN_MS) {
    scheduleRenewal()
    return
  }
  renew()
}

function watchReturn() {
  if (watching) return
  watching = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnReturn()
  })
  window.addEventListener('online', refreshOnReturn)
}

// ---------- API pública ----------

export async function initGoogleAuth(callback, onStatus = () => {}) {
  onTokenChange = callback
  onStatusChange = onStatus
  if (!CLIENT_ID) return

  // O token guardado vale por si só: restaura a sessão antes de depender do
  // script do Google. Era esta ordem invertida que jogava para a tela de login
  // quem já estava conectado, sempre que o script demorava a chegar.
  const stored = readPersisted()
  if (stored) {
    currentToken = stored.token
    expiresAt = stored.expiresAt
    onTokenChange(currentToken)
  }

  onStatusChange('loading')
  const ready = await whenGisReady()
  if (!ready) {
    onStatusChange('unavailable')
    watchLateGis()
    return
  }
  becomeReady()

  if (currentToken) {
    scheduleRenewal()
    return
  }
  // Já houve consentimento antes: tenta renovar sem mostrar nada ao usuário.
  if (hadSession()) renew()
}

export async function signIn() {
  if (!tokenClient) {
    if (await whenGisReady()) becomeReady()
  }
  if (!tokenClient) {
    onStatusChange('unavailable')
    watchLateGis()
    return
  }
  tokenClient.requestAccessToken()
}

// Para o botão de "tentar de novo" da tela de login, quando o script do Google
// não chegou na primeira vez.
export async function retryAuth() {
  gisReady = null
  onStatusChange('loading')
  // Aqui o usuário está esperando olhando para a tela: pede o script na hora,
  // em vez de dar mais alguns segundos para o que já falhou.
  injected = false
  injectGis()
  if (await whenGisReady()) return becomeReady()
  onStatusChange('unavailable')
  watchLateGis()
  return false
}

export function signOut() {
  if (currentToken && window.google) {
    window.google.accounts.oauth2.revoke(currentToken, () => {})
  }
  forgetSession()
}

export function getToken() {
  if (currentToken && Date.now() >= expiresAt - EXPIRY_MARGIN_MS) return null
  return currentToken
}

// Devolve um token válido, renovando em silêncio se o atual estiver vencendo.
export async function ensureToken() {
  const valid = getToken()
  if (valid) return valid

  if (!tokenClient) {
    const ready = await whenGisReady()
    if (ready) createTokenClient()
    // Sem o script não dá para renovar — mas também não é motivo para derrubar
    // a sessão: a chamada falha e o app tenta de novo na próxima.
    if (!tokenClient) return null
  }

  return renew()
}

export function isConfigured() {
  return Boolean(CLIENT_ID)
}
