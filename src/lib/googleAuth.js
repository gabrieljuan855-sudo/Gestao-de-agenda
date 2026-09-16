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
// Marca durável de que esta conta já autorizou o app. Vive separada do
// token de propósito: o token é descartável e some a cada falha, mas o
// consentimento continua valendo, e é ele que autoriza tentar entrar em
// silêncio na próxima abertura. Só o botão "Sair" apaga esta marca.
const CONNECTED_KEY = 'gestao-agenda:conectado'
// Qual dos dois logins está em uso. Fica guardado para uma sondagem que falhe
// por rede não rebaixar o app para o fluxo antigo sem necessidade.
const MODE_KEY = 'gestao-agenda:modo'
const SERVER = 'servidor'
const GIS = 'gis'
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
// Renovar por causa de um 401 só resolve quando o token está mesmo velho.
// Se o Google recusa um token recém-emitido (acesso revogado), insistir vira
// laço: renova, tenta, toma 401, renova. Uma tentativa por vez, e não mais
// que uma a cada 30s.
const UNAUTHORIZED_COOLDOWN_MS = 30 * 1000

let tokenClient = null
let currentToken = null
let expiresAt = 0
// Recebe um booleano (conectado ou não), nunca o token: renovação é assunto
// interno deste módulo, e avisar a tela a cada uma fazia a agenda recarregar
// à toa — e, quando o Google recusava o token novo, virava um laço.
let onSessionChange = () => {}
let onStatusChange = () => {}
let pendingRefresh = null
let resolvePendingRefresh = null
let renewTimer = null
let gisReady = null
let gisAttempts = 0
let watching = false
let lateWatcher = null
let lastUnauthorizedRefresh = 0
let mode = null

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: currentToken, expiresAt }))
    localStorage.setItem(CONNECTED_KEY, '1')
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
    // O STORAGE_KEY entra aqui só por causa de quem já usava o app antes de
    // a marca existir: na primeira renovação bem-sucedida ela é gravada.
    return localStorage.getItem(CONNECTED_KEY) !== null || localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    return false
  }
}

function clearPersisted({ forgetConsent = false } = {}) {
  try {
    localStorage.removeItem(STORAGE_KEY)
    if (forgetConsent) localStorage.removeItem(CONNECTED_KEY)
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

  // Agora é este módulo que pede o script, então pede já.
  injectGis()

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
  // Duas tentativas: a primeira ao entrar no fluxo antigo, a segunda se em
  // alguns segundos ela não tiver chegado (rede de celular derruba direto).
  if (gisAttempts >= 2) return
  gisAttempts += 1
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
        onSessionChange(true)
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

// ---------- login pelo servidor (authorization code) ----------

function readMode() {
  try {
    return localStorage.getItem(MODE_KEY)
  } catch {
    return null
  }
}

function rememberMode(value) {
  mode = value
  try {
    localStorage.setItem(MODE_KEY, value)
  } catch {
    // Sem armazenamento: o modo vale só nesta aba, e a sondagem se repete.
  }
}

function adoptToken(data) {
  currentToken = data.access_token
  expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000
  persist()
  scheduleRenewal()
  onSessionChange(true)
  return currentToken
}

// Pede um access token novo ao Worker, que o tira do refresh token guardado
// no cookie. Não depende de script, de iframe nem do cookie de sessão do
// Google — é por isso que funciona no atalho da tela de início, onde o fluxo
// antigo nunca teve como renovar.
//
// O desfecho é explícito de propósito: só 'deslogado' derruba a sessão. Um
// Worker instável ou um celular sem rede não são motivo para mandar ninguém
// fazer login de novo.
//   'entrou'          -> token novo já adotado
//   'deslogado'       -> não há sessão no servidor (cookie ausente ou morto)
//   'instavel'        -> servidor ou Google com problema passageiro
//   'nao_configurado' -> este Worker não tem o login pelo servidor
//   'indefinido'      -> não deu para falar com o servidor
async function askServerForToken() {
  let res
  try {
    res = await fetch('/api/auth/token', { method: 'POST' })
  } catch {
    return 'indefinido'
  }
  if (res.status === 501) return 'nao_configurado'
  if (res.status === 401) return 'deslogado'
  if (!res.ok) return 'instavel'
  const data = await res.json().catch(() => null)
  if (!data?.access_token) return 'instavel'
  adoptToken(data)
  return 'entrou'
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

// Descarta o token. Por padrão guarda o consentimento: uma renovação que
// falhou não é o usuário pedindo para sair, e sem essa distinção bastava um
// tropeço para o app parar de tentar entrar sozinho em todas as aberturas
// seguintes — que é o "pede login toda hora".
function forgetSession({ forgetConsent = false } = {}) {
  clearTimeout(renewTimer)
  renewTimer = null
  currentToken = null
  expiresAt = 0
  clearPersisted({ forgetConsent })
  onSessionChange(false)
}

async function renew() {
  if (mode === SERVER) {
    const outcome = await askServerForToken()
    if (outcome === 'entrou') return currentToken
    if (outcome === 'deslogado') forgetSession()
    return null
  }

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

export async function initGoogleAuth(onSession, onStatus = () => {}) {
  onSessionChange = onSession
  onStatusChange = onStatus
  mode = readMode()

  // O token guardado vale por si só: restaura a sessão antes de depender do
  // script do Google. Era esta ordem invertida que jogava para a tela de login
  // quem já estava conectado, sempre que o script demorava a chegar.
  const stored = readPersisted()
  if (stored) {
    currentToken = stored.token
    expiresAt = stored.expiresAt
    onSessionChange(true)
  }

  onStatusChange('loading')

  // O login pelo servidor vem primeiro: quando está configurado, não é
  // preciso nem carregar o script do Google.
  const outcome = await askServerForToken()
  const naServidor =
    outcome === 'entrou' ||
    outcome === 'deslogado' ||
    outcome === 'instavel' ||
    // Não deu para perguntar (sem rede): se a última vez foi pelo servidor,
    // continua nele em vez de rebaixar para o fluxo antigo.
    (outcome === 'indefinido' && readMode() === SERVER)

  if (naServidor) {
    rememberMode(SERVER)
    onStatusChange('ready')
    watchReturn()
    if (outcome === 'deslogado') forgetSession()
    else if (currentToken) scheduleRenewal()
    return
  }

  if (!CLIENT_ID) {
    // Nem Worker configurado nem client id no build: não há login possível.
    onStatusChange('unconfigured')
    return
  }
  rememberMode(GIS)

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
  if (mode === SERVER) {
    // Navegação de topo, não pop-up: no atalho da tela de início o pop-up é
    // bloqueado ou abre fora do app, e o usuário fica olhando para nada.
    window.location.assign('/api/auth/start')
    return
  }

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
  // Aqui o usuário está esperando olhando para a tela: zera as tentativas e
  // pede de novo, em vez de dar mais alguns segundos para o que já falhou.
  gisAttempts = 0
  if (await whenGisReady()) return becomeReady()
  onStatusChange('unavailable')
  watchLateGis()
  return false
}

export function signOut() {
  if (mode === SERVER) {
    // Some com o cookie e revoga no Google; o erro não importa, a sessão
    // local vai embora de qualquer jeito.
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    forgetSession({ forgetConsent: true })
    return
  }

  if (currentToken && window.google) {
    window.google.accounts.oauth2.revoke(currentToken, () => {})
  }
  forgetSession({ forgetConsent: true })
}

// O Google recusou um token que o nosso relógio dava como válido (401): pode
// ser acesso revogado, ou a hora do aparelho fora do lugar. Renova uma vez
// para a chamada poder ser repetida, em vez de a tela simplesmente ficar
// vazia sem explicação.
export async function refreshAfterUnauthorized(staleToken) {
  // Outra chamada em paralelo já renovou: aproveita o token novo.
  if (staleToken && currentToken && staleToken !== currentToken) return getToken()
  // Um recarregamento dispara várias chamadas ao mesmo tempo, então elas tomam
  // 401 juntas. Quem chega depois espera a renovação que já está em curso, em
  // vez de abrir outra — ou de esbarrar no intervalo abaixo e desistir à toa.
  if (pendingRefresh) return pendingRefresh
  if (Date.now() - lastUnauthorizedRefresh < UNAUTHORIZED_COOLDOWN_MS) return null
  lastUnauthorizedRefresh = Date.now()

  currentToken = null
  expiresAt = 0
  if (mode === SERVER) return renew()
  if (!tokenClient && (await whenGisReady())) createTokenClient()
  if (!tokenClient) return null
  return renew()
}

export function getToken() {
  if (currentToken && Date.now() >= expiresAt - EXPIRY_MARGIN_MS) return null
  return currentToken
}

// Devolve um token válido, renovando em silêncio se o atual estiver vencendo.
export async function ensureToken() {
  const valid = getToken()
  if (valid) return valid

  if (mode === SERVER) return renew()

  if (!tokenClient) {
    const ready = await whenGisReady()
    if (ready) createTokenClient()
    // Sem o script não dá para renovar — mas também não é motivo para derrubar
    // a sessão: a chamada falha e o app tenta de novo na próxima.
    if (!tokenClient) return null
  }

  return renew()
}
