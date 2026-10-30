import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../index.js'
import { emailPermitidoNoConector } from '../auth.js'
import { _limparCacheDeTokens, MSG_RECONECTAR, tokenDeAcesso } from './google.js'
import { ESPERA_PELO_DESFECHO } from './oauth.js'
import { kvEmMemoria } from '../teste/kvMemoria.js'
import { googleFalso } from '../teste/googleFalso.js'

const ORIGEM = 'https://segundo-cerebro.exemplo.dev'
const CALLBACK_DO_CLAUDE = 'https://claude.ai/api/mcp/auth_callback'

function ambiente(extra = {}) {
  return {
    OAUTH_KV: kvEmMemoria(),
    GOOGLE_CLIENT_ID: 'id-do-app',
    GOOGLE_CLIENT_SECRET: 'segredo',
    SESSION_SECRET: 'x'.repeat(40),
    ALLOWED_EMAIL: 'Eu@Exemplo.com',
    ASSETS: { fetch: async () => new Response('o site', { status: 200 }) },
    ...extra,
  }
}

const ctx = { waitUntil() {}, passThroughOnException() {} }

function chamar(env, caminho, init = {}) {
  return worker.fetch(new Request(`${ORIGEM}${caminho}`, { ...init, headers: { Host: new URL(ORIGEM).host, ...(init.headers || {}) } }), env, ctx)
}

// Os cookies de uma resposta, prontos para mandar de volta no próximo pedido.
function cookiesDe(res) {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

async function pkce() {
  const verifier = 'v'.repeat(50)
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return { verifier, challenge }
}

let g
let emailDoGoogle
let pedidosAoGoogle
let codigosUsados

beforeEach(() => {
  _limparCacheDeTokens()
  g = googleFalso({ agora: () => new Date('2026-10-30T17:00:00Z') })
  g.criarLista('Entrada')
  emailDoGoogle = 'eu@exemplo.com'
  pedidosAoGoogle = []
  codigosUsados = new Set()
  ESPERA_PELO_DESFECHO.intervaloMs = 1
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const alvo = String(url)
    if (alvo.startsWith('https://oauth2.googleapis.com/token')) {
      const corpo = new URLSearchParams(init.body)
      pedidosAoGoogle.push(Object.fromEntries(corpo))
      // Como o Google de verdade: cada código troca uma vez só.
      const code = corpo.get('code')
      if (code && codigosUsados.has(code)) {
        return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Bad Request' }), { status: 400 })
      }
      if (code) codigosUsados.add(code)
      if (corpo.get('refresh_token') === 'revogado') {
        return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), { status: 400 })
      }
      return new Response(JSON.stringify({ access_token: 'acesso-google', refresh_token: 'refresh-google', expires_in: 3600, scope: 'tudo' }), { status: 200 })
    }
    if (alvo.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
      return new Response(JSON.stringify({ email: emailDoGoogle }), { status: 200 })
    }
    return g.fetch(alvo, init)
  })
})

afterEach(() => vi.unstubAllGlobals())

// O caminho que o Claude percorre: registrar-se, mandar a pessoa ao
// /authorize, ela permite, vai ao Google e volta.
async function conectar(env, { comCookieNaVolta = true, semVolta = false } = {}) {
  const reg = await chamar(env, '/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK_DO_CLAUDE], token_endpoint_auth_method: 'none' }),
  })
  expect(reg.status).toBe(201)
  const { client_id } = await reg.json()
  const { verifier, challenge } = await pkce()
  const params = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: CALLBACK_DO_CLAUDE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'estado-do-claude',
    resource: `${ORIGEM}/mcp`,
  })
  const pagina = await chamar(env, `/authorize?${params}`)
  expect(pagina.status).toBe(200)
  const html = await pagina.text()
  const handle = html.match(/name="handle" value="([^"]+)"/)[1]
  const permitir = await chamar(env, '/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookiesDe(pagina), 'Sec-Fetch-Mode': 'navigate' },
    body: new URLSearchParams({ handle, decisao: 'permitir' }),
  })
  expect(permitir.status).toBe(302)
  const google = new URL(permitir.headers.get('Location'))
  if (semVolta) return { html, google, client_id, verifier }
  const volta = await chamar(env, `/conector/callback?code=codigo-do-google&state=${encodeURIComponent(google.searchParams.get('state'))}`, {
    headers: comCookieNaVolta ? { Cookie: cookiesDe(permitir) } : {},
  })
  return { html, google, volta, client_id, verifier }
}

describe('login do conector', () => {
  it('pede ao Google os mesmos escopos e o mesmo client ID do app, com refresh token garantido', async () => {
    const env = ambiente()
    const { html, google } = await conectar(env)
    expect(html).toContain('Permitir que Claude use o Segundo Cérebro?')
    expect(html).toContain('claude.ai')
    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(google.searchParams.get('client_id')).toBe('id-do-app')
    expect(google.searchParams.get('scope').split(' ')).toEqual([
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/tasks',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/drive.appdata',
    ])
    expect(google.searchParams.get('access_type')).toBe('offline')
    expect(google.searchParams.get('prompt')).toBe('consent')
    expect(google.searchParams.get('redirect_uri')).toBe(`${ORIGEM}/conector/callback`)
  })

  it('recusa uma conta Google que não é a de ALLOWED_EMAIL', async () => {
    emailDoGoogle = 'outra@pessoa.com'
    const { volta } = await conectar(ambiente())
    expect(volta.status).toBe(403)
    expect(await volta.text()).toContain('não é a dona deste Segundo Cérebro')
  })

  it('sem ALLOWED_EMAIL, o conector não abre para ninguém', async () => {
    const env = ambiente({ ALLOWED_EMAIL: '' })
    const res = await chamar(env, '/authorize?client_id=qualquer')
    expect(res.status).toBe(503)
    expect(emailPermitidoNoConector({ ALLOWED_EMAIL: '' }, 'eu@exemplo.com')).toBe(false)
    expect(emailPermitidoNoConector({ ALLOWED_EMAIL: 'eu@exemplo.com' }, 'EU@exemplo.com ')).toBe(true)
  })

  it('com a conta certa, conclui, troca o código e o Claude usa as ferramentas pelo /mcp', async () => {
    const env = ambiente()
    const { volta, client_id, verifier } = await conectar(env)
    expect(volta.status).toBe(303)
    const deVolta = new URL(volta.headers.get('Location'))
    expect(deVolta.origin + deVolta.pathname).toBe(CALLBACK_DO_CLAUDE)
    expect(deVolta.searchParams.get('state')).toBe('estado-do-claude')

    const token = await chamar(env, '/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: deVolta.searchParams.get('code'),
        redirect_uri: CALLBACK_DO_CLAUDE,
        client_id,
        code_verifier: verifier,
        resource: `${ORIGEM}/mcp`,
      }),
    })
    expect(token.status).toBe(200)
    const { access_token } = await token.json()
    // O refresh token do Google não vaza para o KV em texto puro.
    expect([...env.OAUTH_KV.dados.values()].some((v) => v.valor.includes('refresh-google'))).toBe(false)

    const mcp = (method, params, origem = 'https://claude.ai') =>
      chamar(env, '/mcp', {
        method: 'POST',
        headers: {
          // O Claude pode chamar com Origin de claude.ai; o padrão da
          // biblioteca recusaria com 403.
          Origin: origem,
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-06-18',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }).then(async (r) => {
        const texto = await r.text()
        return JSON.parse(texto.split('\n').find((l) => l.startsWith('data: '))?.slice(6) || texto)
      })
    const lista = await mcp('tools/list', {})
    expect(lista.result.tools.length).toBeGreaterThan(10)
    const captura = await mcp('tools/call', { name: 'capturar', arguments: { texto: 'pagar o IPTU' } })
    expect(captura.result.content[0].text).toMatch(/Guardado na Entrada/)
    expect(g.estado.tarefas[0].title).toBe('pagar o IPTU')
    // Qualquer outro site continua barrado.
    expect((await mcp('tools/list', {}, 'https://site-qualquer.com')).error.message).toMatch(/Invalid Origin/)
  })

  it('a volta do Google funciona mesmo sem cookie (o navegador embutido do app do Claude no iPhone não o devolve)', async () => {
    const { volta } = await conectar(ambiente(), { comCookieNaVolta: false })
    expect(volta.status).toBe(303)
    expect(new URL(volta.headers.get('Location')).searchParams.get('code')).toBeTruthy()
  })

  it('a volta do Google repetida recebe a mesma resposta da primeira, em vez de erro', async () => {
    const env = ambiente()
    const { google, volta } = await conectar(env)
    const caminho = `/conector/callback?code=codigo-do-google&state=${encodeURIComponent(google.searchParams.get('state'))}`
    const repetida = await chamar(env, caminho)
    expect(repetida.status).toBe(303)
    expect(repetida.headers.get('Location')).toBe(volta.headers.get('Location'))
    expect(pedidosAoGoogle.filter((p) => p.grant_type === 'authorization_code')).toHaveLength(1)
  })

  it('duas voltas ao mesmo tempo com o mesmo código terminam no mesmo lugar', async () => {
    const env = ambiente()
    const { google } = await conectar(env, { semVolta: true })
    const caminho = `/conector/callback?code=codigo-do-google&state=${encodeURIComponent(google.searchParams.get('state'))}`
    const [a, b] = await Promise.all([chamar(env, caminho), chamar(env, caminho)])
    expect([a.status, b.status]).toEqual([303, 303])
    expect(new URL(a.headers.get('Location')).searchParams.get('code')).toBeTruthy()
    expect(b.headers.get('Location')).toBe(a.headers.get('Location'))
  })

  it('a repetição de uma conta recusada continua recusada', async () => {
    emailDoGoogle = 'outra@exemplo.com'
    const env = ambiente()
    const { google, volta } = await conectar(env)
    expect(volta.status).toBe(403)
    const repetida = await chamar(env, `/conector/callback?code=codigo-do-google&state=${encodeURIComponent(google.searchParams.get('state'))}`)
    expect(repetida.status).toBe(403)
    expect(await repetida.text()).toContain('outra@exemplo.com')
  })

  it('o pedido em segundo plano do navegador do iPhone não gasta o Permitir', async () => {
    const env = ambiente()
    const reg = await chamar(env, '/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK_DO_CLAUDE], token_endpoint_auth_method: 'none' }),
    })
    const { client_id } = await reg.json()
    const { challenge } = await pkce()
    const params = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CALLBACK_DO_CLAUDE, code_challenge: challenge, code_challenge_method: 'S256', state: 'e' })
    const pagina = await chamar(env, `/authorize?${params}`)
    const handle = (await pagina.text()).match(/name="handle" value="([^"]+)"/)[1]
    const enviar = (modo) =>
      chamar(env, '/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookiesDe(pagina), 'Sec-Fetch-Mode': modo },
        body: new URLSearchParams({ handle, decisao: 'permitir' }),
      })
    // O de segundo plano não faz nada; a navegação depois dele ainda vai ao Google.
    expect((await enviar('cors')).status).toBe(204)
    const real = await enviar('navigate')
    expect(real.status).toBe(302)
    expect(real.headers.get('Location')).toContain('accounts.google.com')
  })

  it('a volta repetida em segundo plano não leva o código ao Claude nem gasta o state', async () => {
    const env = ambiente()
    const { google } = await conectar(env, { semVolta: true })
    const caminho = `/conector/callback?code=codigo-do-google&state=${encodeURIComponent(google.searchParams.get('state'))}`
    const fundo = await chamar(env, caminho, { method: 'POST', headers: { 'Sec-Fetch-Mode': 'cors' } })
    expect(fundo.status).toBe(204)
    expect(fundo.headers.get('Location')).toBeNull()
    expect(pedidosAoGoogle.filter((p) => p.grant_type === 'authorization_code')).toHaveLength(0)
    const real = await chamar(env, caminho, { headers: { 'Sec-Fetch-Mode': 'navigate' } })
    expect(real.status).toBe(303)
    expect(real.headers.get('Location')).toContain(CALLBACK_DO_CLAUDE)
  })

  it('um state inventado ou vencido não conclui nada', async () => {
    const inventada = await chamar(ambiente(), '/conector/callback?code=x&state=inventado')
    expect(inventada.status).toBe(400)
    expect(await inventada.text()).toContain('expirou')
  })

  it('o /mcp sem token devolve o desafio OAuth que aponta para a descoberta', async () => {
    const env = ambiente()
    const res = await chamar(env, '/mcp', { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata=')
    const meta = await (await chamar(env, '/.well-known/oauth-protected-resource/mcp')).json()
    expect(meta.resource).toBe(`${ORIGEM}/mcp`)
  })
})

describe('token do Google nas ferramentas', () => {
  it('guarda o access token em memória até expirar', async () => {
    const env = ambiente()
    const props = { googleRefreshToken: 'refresh-google' }
    const agora = Date.parse('2026-10-30T17:00:00Z')
    await tokenDeAcesso(env, props, { agora })
    await tokenDeAcesso(env, props, { agora: agora + 30 * 60 * 1000 })
    expect(pedidosAoGoogle).toHaveLength(1)
    await tokenDeAcesso(env, props, { agora: agora + 60 * 60 * 1000 })
    expect(pedidosAoGoogle).toHaveLength(2)
  })

  it('invalid_grant vira a instrução de reconectar o conector', async () => {
    await expect(tokenDeAcesso(ambiente(), { googleRefreshToken: 'revogado' })).rejects.toThrow(MSG_RECONECTAR)
  })
})

describe('as rotas de antes continuam iguais', () => {
  it('o site e as rotas /api/* não passam pelo conector', async () => {
    const env = ambiente()
    expect(await (await chamar(env, '/')).text()).toBe('o site')
    expect((await chamar(env, '/api/esclarecer')).status).toBe(405)
    expect((await chamar(env, '/api/esclarecer', { method: 'POST', body: '{}' })).status).toBe(401)
    expect((await chamar(env, '/api/briefing', { method: 'POST', body: '{}' })).status).toBe(401)
    expect((await chamar(env, '/api/avisos', { method: 'POST', body: '{}' })).status).toBe(401)
    const login = await chamar(env, '/api/auth/start')
    expect(login.status).toBe(302)
    expect(login.headers.get('Location')).toContain(encodeURIComponent(`${ORIGEM}/api/auth/callback`))
    expect((await chamar(env, '/api/auth/token', { method: 'POST' })).status).toBe(401)
  })

  it('sem o KV do conector, o app segue de pé e só o conector avisa', async () => {
    const env = ambiente({ OAUTH_KV: undefined })
    expect(await (await chamar(env, '/')).text()).toBe('o site')
    expect((await chamar(env, '/api/esclarecer')).status).toBe(405)
    const mcp = await chamar(env, '/mcp', { method: 'POST' })
    expect(mcp.status).toBe(503)
    expect((await mcp.json()).error).toMatch(/OAUTH_KV/)
  })
})
