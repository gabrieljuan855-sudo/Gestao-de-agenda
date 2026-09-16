// Login pelo Worker, no fluxo de authorization code.
//
// O app nasceu com o fluxo implícito do Google Identity Services: um token de
// uma hora, renovado por um iframe escondido que depende do cookie de sessão
// do Google no navegador. No atalho da tela de início do iOS esse cookie não
// existe — o app instalado tem armazenamento separado do Safari —, então a
// renovação silenciosa nunca tinha como funcionar e o login voltava a cada
// hora.
//
// Aqui quem troca o código pelo token é o Worker, que recebe junto um refresh
// token. Refresh token não depende de cookie nenhum do Google: vale até ser
// revogado. Ele fica cifrado num cookie httpOnly do nosso próprio domínio, o
// navegador nunca lê o valor, e o app pede um access token novo em
// /api/auth/token sempre que precisa.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

const SESSION_COOKIE = 'ga_sessao'
const FLOW_COOKIE = 'ga_fluxo'
// O Chrome limita qualquer cookie a 400 dias; pedir mais é pedir 400.
const SESSION_MAX_AGE = 400 * 24 * 60 * 60
const FLOW_MAX_AGE = 10 * 60

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

// ---------- cifra do cookie ----------

function b64urlEncode(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(text) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

function keyFrom(secret) {
  return crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(secret))
    .then((raw) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']))
}

// O refresh token vale tanto quanto a conta: cifrar significa que um cookie
// vazado não serve para nada sem o segredo que só o Worker tem.
async function seal(secret, value) {
  const key = await keyFrom(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const body = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)))
  )
  const out = new Uint8Array(iv.length + body.length)
  out.set(iv)
  out.set(body, iv.length)
  return b64urlEncode(out)
}

async function unseal(secret, token) {
  try {
    const bytes = b64urlDecode(token)
    const key = await keyFrom(secret)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      key,
      bytes.slice(12)
    )
    return JSON.parse(new TextDecoder().decode(plain))
  } catch {
    // Cookie adulterado, ou cifrado com um segredo que já mudou.
    return null
  }
}

// ---------- cookies ----------

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || ''
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

// SameSite=Lax deixa o cookie viajar na volta do Google (navegação de topo) e
// o bloqueia num POST vindo de outro site, que é a proteção de CSRF de que
// /api/auth/token precisa.
function setCookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

// ---------- PKCE ----------

function randomText(bytes = 32) {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return b64urlEncode(new Uint8Array(digest))
}

// ---------- configuração ----------

export function isConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET)
}

function redirectUri(request) {
  return new URL('/api/auth/callback', request.url).toString()
}

function allowedEmail(env, email) {
  if (!env.ALLOWED_EMAIL) return true
  return String(email || '').toLowerCase() === env.ALLOWED_EMAIL.toLowerCase()
}

// ---------- rotas ----------

async function start(request, env) {
  const state = randomText()
  const verifier = randomText(48)
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(request),
    response_type: 'code',
    scope: SCOPES,
    // Sem access_type=offline não vem refresh token, e sem prompt=consent o
    // Google só o manda na primeira autorização de todas — quem já tinha
    // autorizado pelo fluxo antigo ficaria sem, sem nenhum aviso.
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
  })

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${AUTH_URL}?${params}`,
      'Set-Cookie': setCookie(FLOW_COOKIE, await seal(env.SESSION_SECRET, { state, verifier }), FLOW_MAX_AGE),
    },
  })
}

// Erro no meio do login vira uma volta para a home com um aviso legível, e
// não uma página branca de JSON: quem está aqui é uma pessoa tentando entrar.
function backHome(request, reason) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(`/?erro_login=${encodeURIComponent(reason)}`, request.url).toString(),
      'Set-Cookie': clearCookie(FLOW_COOKIE),
    },
  })
}

async function exchange(env, body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `token ${res.status}`)
    // O código vem separado da mensagem de propósito: é por ele que se
    // distingue "a sessão morreu" de "o Google está instável", e a descrição
    // ("Token has been expired or revoked.") não carrega esse código.
    err.code = data.error || ''
    throw err
  }
  return data
}

async function callback(request, env) {
  const url = new URL(request.url)
  if (url.searchParams.get('error')) return backHome(request, url.searchParams.get('error'))

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const sealed = readCookie(request, FLOW_COOKIE)
  if (!code || !state || !sealed) return backHome(request, 'pedido_incompleto')

  const flow = await unseal(env.SESSION_SECRET, sealed)
  if (!flow || flow.state !== state) return backHome(request, 'estado_invalido')

  let tokens
  try {
    tokens = await exchange(env, {
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(request),
      grant_type: 'authorization_code',
      code_verifier: flow.verifier,
    })
  } catch (err) {
    return backHome(request, err.message)
  }

  if (!tokens.refresh_token) return backHome(request, 'sem_refresh_token')

  // Quem entrou precisa ser o dono: sem esta conferência, qualquer pessoa
  // abriria /api/auth/start e ganharia uma sessão neste Worker.
  const who = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (!allowedEmail(env, who?.email)) return backHome(request, 'conta_nao_autorizada')

  const cookie = await seal(env.SESSION_SECRET, {
    refresh_token: tokens.refresh_token,
    email: who?.email || null,
  })

  return new Response(null, {
    status: 302,
    headers: [
      ['Location', new URL('/', request.url).toString()],
      ['Set-Cookie', setCookie(SESSION_COOKIE, cookie, SESSION_MAX_AGE)],
      ['Set-Cookie', clearCookie(FLOW_COOKIE)],
    ],
  })
}

async function token(request, env) {
  const sealed = readCookie(request, SESSION_COOKIE)
  if (!sealed) return json({ error: 'sem_sessao' }, 401)

  const session = await unseal(env.SESSION_SECRET, sealed)
  if (!session?.refresh_token) {
    return json({ error: 'sessao_invalida' }, 401, { 'Set-Cookie': clearCookie(SESSION_COOKIE) })
  }

  let tokens
  try {
    tokens = await exchange(env, {
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: session.refresh_token,
      grant_type: 'refresh_token',
    })
  } catch (err) {
    // invalid_grant é o Google dizendo que o refresh token morreu (revogado,
    // senha trocada, ou app ainda "em teste", onde ele expira em 7 dias).
    // Aí a sessão acabou mesmo e o cookie tem que sair. Qualquer outro erro é
    // problema passageiro: a sessão fica de pé para a próxima tentativa.
    const dead = err.code === 'invalid_grant'
    return json({ error: err.message }, dead ? 401 : 502, dead ? { 'Set-Cookie': clearCookie(SESSION_COOKIE) } : {})
  }

  return json({
    access_token: tokens.access_token,
    expires_in: tokens.expires_in || 3600,
    email: session.email || null,
  })
}

async function logout(request, env) {
  const sealed = readCookie(request, SESSION_COOKIE)
  const session = sealed ? await unseal(env.SESSION_SECRET, sealed) : null
  if (session?.refresh_token) {
    // Melhor esforço: se a revogação falhar, o cookie sai do mesmo jeito.
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: session.refresh_token }),
    }).catch(() => {})
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(SESSION_COOKIE) })
}

export async function handleAuth(request, env, pathname) {
  // Sem os segredos configurados o Worker diz isso claramente, e o app volta
  // sozinho para o fluxo antigo em vez de ficar com um login quebrado.
  if (!isConfigured(env)) {
    return json({ error: 'login_pelo_servidor_nao_configurado', configured: false }, 501)
  }

  if (pathname === '/api/auth/start') return start(request, env)
  if (pathname === '/api/auth/callback') return callback(request, env)
  if (pathname === '/api/auth/token') {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
    return token(request, env)
  }
  if (pathname === '/api/auth/logout') {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
    return logout(request, env)
  }
  return json({ error: 'Rota desconhecida.' }, 404)
}
