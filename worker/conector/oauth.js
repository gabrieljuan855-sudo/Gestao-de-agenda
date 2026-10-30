// O lado OAuth do conector do Claude.
//
// O Claude é um cliente OAuth deste Worker: ele se registra sozinho
// (/register, ou um Client ID Metadata Document), manda a pessoa para
// /authorize e troca o código em /token. Quem cuida disso é o OAuthProvider da
// Cloudflare; a parte que é nossa é o /authorize: dizer quem está pedindo
// acesso, mandar para o Google com os mesmos escopos e o mesmo client ID do
// app, e só concluir se a conta for a de ALLOWED_EMAIL.
//
// O refresh token do Google vai nas `props` da concessão, que o provider
// guarda cifradas no KV com uma chave que só o token do Claude abre.

import {
  OAuthProvider,
  OAuthError,
  AuthorizationError,
  CimdFetchError,
  authorizationErrorRedirect,
} from '@cloudflare/workers-oauth-provider'
import { createMcpHandler } from 'agents/mcp/server'
import {
  urlDoGoogle,
  trocarCodigo,
  renovarAcesso,
  emailDaConta,
  emailPermitidoNoConector,
  isConfigured,
  randomText,
  limpo,
} from '../auth.js'
import { criarServidor } from './servidor.js'

export const ROTA_MCP = '/mcp'
// Fora de /mcp de propósito: tudo abaixo de /mcp é rota protegida por token
// para o provider, e a volta do Google chega sem token nenhum.
export const ROTA_CALLBACK = '/conector/callback'
const ROTAS_DE_PAGINA = new Set(['/authorize', ROTA_CALLBACK])
const ROTAS_DO_PROVEDOR = new Set(['/token', '/register'])

// As rotas que são do conector. Todo o resto (o site, /api/*) não passa pelo
// provider: segue para o Worker de sempre, exatamente como antes do conector.
export function ehRotaDoConector(pathname) {
  return (
    pathname === ROTA_MCP ||
    pathname.startsWith(`${ROTA_MCP}/`) ||
    ROTAS_DE_PAGINA.has(pathname) ||
    ROTAS_DO_PROVEDOR.has(pathname) ||
    pathname.startsWith('/.well-known/oauth-')
  )
}

// Sem ALLOWED_EMAIL ou sem os segredos do login, o conector não existe: ele
// entregaria a conta a quem chegasse primeiro.
export function conectorConfigurado(env) {
  return Boolean(isConfigured(env) && limpo(env.ALLOWED_EMAIL))
}

const escapar = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// Página simples, nas cores do app (paleta Chocolate de src/index.css), com o
// que o MCP exige que se mostre antes de dar acesso: quem pede, para onde vão
// os tokens, e o aviso quando o destino é um programa no próprio computador.
function pagina(titulo, corpo, status = 200, headers = new Headers()) {
  headers.set('Content-Type', 'text/html; charset=utf-8')
  return new Response(
    `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)} · Segundo Cérebro</title>
<style>
  :root { --surface: #fffcf7; --card: #ede4d4; --texto: #4a3520; --suave: #8c6a48; --primary: #8c5927; --on-primary: #fff; --borda: #c4ac95; }
  @media (prefers-color-scheme: dark) { :root { --surface: #141010; --card: #241c18; --texto: #f3e9dc; --suave: #c4ac95; --primary: #e0a96d; --on-primary: #2a1a0c; --borda: #6b5540; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--surface); color: var(--texto); font: 16px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 420px; margin: 16px; padding: 24px; border-radius: 28px; background: var(--card); }
  h1 { font-size: 22px; margin: 0 0 12px; }
  p { margin: 0 0 12px; }
  .suave { color: var(--suave); font-size: 14px; }
  .aviso { padding: 10px 12px; border-radius: 12px; border: 1px solid var(--borda); }
  .acoes { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
  button { font: inherit; min-height: 40px; padding: 0 20px; border-radius: 999px; border: none; cursor: pointer; }
  .primario { background: var(--primary); color: var(--on-primary); }
  .texto { background: transparent; color: var(--primary); }
</style></head>
<body><main>${corpo}</main></body></html>`,
    { status, headers }
  )
}

function erroLocal(titulo, mensagem, status = 400) {
  return pagina(titulo, `<h1>${escapar(titulo)}</h1><p>${escapar(mensagem)}</p>`, status)
}

// ---------- a ida e a volta do Google ----------
//
// Entre o "Permitir" e a volta do Google, o pedido aprovado precisa ficar
// guardado. A biblioteca oferece beginUpstream/finishUpstream para isso, que
// amarram a volta a um cookie de uso único — e no iPhone a volta caía em "This
// authorization was not started in this browser", enquanto no Chromium e no
// curl o mesmo fluxo passava (a causa era o service worker do app, ver
// paginasDoConector; o state no KV ficou por ser mais simples e robusto).
//
// Aqui o pedido aprovado fica no KV, achado pelo `state` que vai ao Google:
// 32 bytes aleatórios, que valem 10 minutos, guardados só pelo hash. O que o
// cookie protegia (alguém reaproveitar a volta de outra pessoa) continua
// coberto: o `state` e o código do Google só existem na barra de endereço de
// quem fez o login, o código só é trocado junto com o verificador PKCE
// guardado aqui, e a autorização só vai para o endereço do cliente que a
// pessoa aprovou na tela de consentimento — essa, sim, segue amarrada ao
// cookie, que funciona porque é o mesmo site do começo ao fim.
const VALIDADE_DA_VOLTA_S = 10 * 60

async function hashHex(texto) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function guardarIdaAoGoogle(kv, pedido, verifier) {
  const state = randomText(32)
  await kv.put(`conector-volta:${await hashHex(state)}`, JSON.stringify({ pedido, verifier }), {
    expirationTtl: VALIDADE_DA_VOLTA_S,
  })
  return state
}

// A volta do Google pode chegar duas vezes (toque duplo no "Continuar" do
// Google, recarga da página). Com o `state` apagado no primeiro uso, a
// repetição — que é a que fica na tela — dizia "expirou ou já foi usada",
// mesmo quando a primeira tinha dado certo. Por isso o desfecho de cada volta fica guardado pelo mesmo
// tempo do `state`, e a repetição recebe exatamente a mesma resposta. Quem
// repete é o próprio navegador da pessoa: o `state` só existe na barra de
// endereço dela, e o código entregue ao Claude continua de uso único lá.
const chaveDaVolta = (hash) => `conector-volta:${hash}`
const chaveDoDesfecho = (hash) => `conector-desfecho:${hash}`

async function lerJson(kv, chave) {
  const guardado = await kv.get(chave)
  if (!guardado) return null
  try {
    return JSON.parse(guardado)
  } catch {
    return null
  }
}

// O que já se sabe sobre um `state`: o desfecho, se a volta já foi tratada;
// senão, o pedido guardado na ida; null quando ele não existe ou venceu.
export async function recuperarVoltaDoGoogle(kv, state) {
  if (!state) return null
  const hash = await hashHex(state)
  const desfecho = await lerJson(kv, chaveDoDesfecho(hash))
  if (desfecho) return { hash, desfecho }
  const ida = await lerJson(kv, chaveDaVolta(hash))
  return ida?.pedido ? { hash, ...ida } : null
}

async function guardarDesfecho(kv, hash, desfecho) {
  // O desfecho primeiro e só depois o pedido sai: uma repetição que chegue no
  // meio do caminho acha um dos dois, nunca nenhum.
  await kv.put(chaveDoDesfecho(hash), JSON.stringify(desfecho), { expirationTtl: VALIDADE_DA_VOLTA_S })
  await kv.delete(chaveDaVolta(hash))
}

// Duas voltas ao mesmo tempo com o mesmo código: o Google aceita só uma troca
// e recusa a outra. A recusada espera um pouco pelo desfecho da que deu certo.
export const ESPERA_PELO_DESFECHO = { tentativas: 16, intervaloMs: 500 }

async function esperarDesfecho(kv, hash) {
  for (let i = 0; i < ESPERA_PELO_DESFECHO.tentativas; i++) {
    await new Promise((r) => setTimeout(r, ESPERA_PELO_DESFECHO.intervaloMs))
    const desfecho = await lerJson(kv, chaveDoDesfecho(hash))
    if (desfecho) return desfecho
  }
  return null
}

function responderDesfecho(desfecho) {
  if (desfecho.erro) return erroLocal(desfecho.erro.titulo, desfecho.erro.mensagem, desfecho.erro.status)
  // 303, e não 302: mesmo que a volta chegue como POST, o navegador vai ao
  // Claude com GET, o único método que o endereço de volta dele aceita.
  return new Response(null, { status: 303, headers: { Location: desfecho.location, 'Cache-Control': 'no-store' } })
}

// GET /authorize: valida o pedido do cliente e pergunta se ele pode entrar.
// POST /authorize: a pessoa aprovou; só agora vai para o Google.
async function autorizar(request, env) {
  const oauth = env.OAUTH_PROVIDER
  if (request.method === 'GET') {
    const pedido = await oauth.parseAuthRequest(request)
    // describeConsent antes de beginConsent: uma busca que falhe não deixa
    // nada guardado no KV.
    const quem = await oauth.describeConsent(pedido)
    const consentimento = await oauth.beginConsent(pedido)
    const origem = quem.clientDomain
      ? `Publicado por <strong>${escapar(quem.clientDomain)}</strong>.`
      : 'Este aplicativo se registrou sozinho; o nome dele não é verificado.'
    const local = quem.redirectIsLoopback
      ? '<p class="aviso"><strong>O acesso vai para um programa neste computador.</strong> Continue só se você acabou de pedir a conexão nele.</p>'
      : ''
    return pagina(
      'Conectar ao Claude',
      `<h1>Permitir que ${escapar(quem.clientName)} use o Segundo Cérebro?</h1>
<p>Ele vai poder ler e gravar suas tarefas, sua agenda, seus projetos e suas anotações, em seu nome.</p>
<p class="suave">${origem} O acesso será enviado para <strong>${escapar(quem.redirectHost)}</strong>.</p>
${local}
<p class="suave">Em seguida o Google vai pedir para você entrar com a conta autorizada neste app.</p>
<form method="post">
  <input type="hidden" name="handle" value="${escapar(consentimento.handle)}">
  <div class="acoes">
    <button class="texto" name="decisao" value="recusar">Recusar</button>
    <button class="primario" name="decisao" value="permitir">Permitir</button>
  </div>
</form>`,
      200,
      consentimento.headers
    )
  }

  if (request.method !== 'POST') return erroLocal('Método não aceito', 'Use o botão da página de conexão.', 405)
  const form = await request.formData()
  const handle = String(form.get('handle') || '')
  if (form.get('decisao') !== 'permitir') {
    const negado = await oauth.denyConsent(request, handle)
    return new Response(null, { status: 302, headers: negado.headers })
  }
  const aprovado = await oauth.approveConsent(request, handle)
  const verifier = randomText(48)
  const state = await guardarIdaAoGoogle(env.OAUTH_KV, aprovado.request, verifier)
  const headers = aprovado.headers
  headers.set('Cache-Control', 'no-store')
  headers.set('Location', await urlDoGoogle(env, { redirectUri: new URL(ROTA_CALLBACK, request.url).toString(), state, verifier }))
  return new Response(null, { status: 302, headers })
}

// A volta do Google: troca o código, confere a conta e conclui a autorização.
async function voltaDoGoogle(request, env) {
  const kv = env.OAUTH_KV
  const url = new URL(request.url)
  const volta = await recuperarVoltaDoGoogle(kv, url.searchParams.get('state'))
  if (!volta) {
    return erroLocal(
      'Não deu para conectar',
      'Esta tentativa de conexão expirou. Feche esta página e toque em Conectar de novo no Claude.'
    )
  }
  if (volta.desfecho) return responderDesfecho(volta.desfecho)

  const desfecho = await concluirVolta(env, url, volta)
  if (desfecho.codigoJaUsado) {
    const daOutra = await esperarDesfecho(kv, volta.hash)
    if (daOutra) return responderDesfecho(daOutra)
  }
  await guardarDesfecho(kv, volta.hash, desfecho)
  return responderDesfecho(desfecho)
}

async function concluirVolta(env, url, { pedido, verifier }) {
  const negar = (descricao) => ({ location: authorizationErrorRedirect(pedido, 'access_denied', descricao) })
  if (url.searchParams.get('error')) return negar('O acesso foi recusado na tela do Google.')

  let tokens
  try {
    tokens = await trocarCodigo(env, {
      code: url.searchParams.get('code') || '',
      redirectUri: new URL(ROTA_CALLBACK, url).toString(),
      verifier,
    })
  } catch (err) {
    return { ...negar(`O Google não completou o login: ${err.message}`), codigoJaUsado: err.code === 'invalid_grant' }
  }
  if (!tokens.refresh_token) return negar('O Google não enviou o acesso permanente (refresh token).')

  // O app é pessoal: a conta precisa ser exatamente a de ALLOWED_EMAIL.
  const email = await emailDaConta(tokens.access_token)
  if (!emailPermitidoNoConector(env, email)) {
    return {
      erro: {
        titulo: 'Conta não autorizada',
        mensagem: `${email ? `A conta ${email}` : 'Esta conta'} não é a dona deste Segundo Cérebro. Volte ao Claude e conecte de novo, entrando com a conta autorizada.`,
        status: 403,
      },
    }
  }

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: pedido,
    // O id do usuário não pode ter ":" (o provider usa o caractere como
    // separador); e-mail não tem, mas codificar deixa isso garantido.
    userId: encodeURIComponent(email.toLowerCase()),
    metadata: { email },
    scope: pedido.scope,
    props: { email, googleRefreshToken: tokens.refresh_token, escopos: tokens.scope || '' },
  })
  return { location: redirectTo }
}

// As páginas do conector (o defaultHandler do provider). Os erros seguem o
// guia da biblioteca: com redirect validado, volta para o cliente; sem, a
// mensagem aparece aqui mesmo, porque o cliente não é confiável.
async function paginasDoConector(request, env) {
  if (!conectorConfigurado(env)) {
    return erroLocal(
      'Conector desativado',
      'Para conectar o Claude, o Worker precisa de GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET e ALLOWED_EMAIL configurados.',
      503
    )
  }
  const { pathname } = new URL(request.url)
  // Só navegação de verdade gasta o que é de uso único (o handle da tela, o
  // state da volta). O service worker do app (public/sw.js), no mesmo
  // domínio, atendia as navegações do login com a página do app guardada e
  // buscava o endereço de verdade por trás — o registro do conector mostrou
  // esses pedidos vindo de /sw.js. A busca por trás gastava o handle ou
  // concluía a volta sem que o navegador saísse do lugar, e a pessoa via o
  // app, um erro ou um "Algo deu errado" no Claude. O sw.js já não toca nessas
  // rotas; isto protege enquanto um iPhone ainda roda a versão antiga dele.
  // Navegador sem Sec-Fetch-Mode segue normalmente.
  const modo = request.headers.get('sec-fetch-mode')
  if (modo && modo !== 'navigate') return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  try {
    if (pathname === '/authorize') return await autorizar(request, env)
    if (pathname === ROTA_CALLBACK) return await voltaDoGoogle(request, env)
  } catch (err) {
    if (err instanceof AuthorizationError && err.redirectTo) return Response.redirect(err.redirectTo, 302)
    if (err instanceof AuthorizationError) {
      // As mensagens da biblioteca vêm em inglês e não dizem o que fazer. O
      // caso comum é a tentativa ter sido usada, expirado ou voltado por outra
      // janela (voltar ou recarregar no meio do caminho já basta para isso),
      // e a saída é sempre a mesma: recomeçar pelo Claude.
      return erroLocal(
        'Não deu para conectar',
        `Esta tentativa de conexão expirou, já foi usada ou voltou por outra janela. Feche esta página e toque em Conectar de novo no Claude, sem voltar nem recarregar no meio do caminho. (Detalhe: ${err.description || err.message})`
      )
    }
    if (err instanceof CimdFetchError) return erroLocal('Não deu para conectar', 'O aplicativo que pediu acesso não pôde ser verificado.')
    throw err
  }
  return erroLocal('Página não encontrada', 'Este endereço não existe.', 404)
}

// O /mcp em si: o handler sem estado do Agents SDK, com um servidor novo por
// requisição. As props (e-mail e refresh token) chegam pelo ctx.props que o
// provider preenche depois de validar o token.
// O padrão da biblioteca do MCP só aceita Origin do próprio workers.dev e
// recusa (403) o resto; se o Claude chamar com Origin de claude.ai, a conexão
// morre logo depois do login, com um "Algo deu errado" sem explicação. A
// conferência continua de pé para qualquer outro site.
const ORIGENS_DO_CLAUDE = ['claude.ai', 'claude.com']

async function servirMcp(request, env, ctx) {
  if (!conectorConfigurado(env) || !emailPermitidoNoConector(env, ctx.props?.email)) {
    return new Response(JSON.stringify({ error: 'Conector desativado ou conta não autorizada.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
  const handler = createMcpHandler(() => criarServidor(env, ctx.props), {
    route: ROTA_MCP,
    allowedOriginHostnames: [new URL(request.url).hostname, ...ORIGENS_DO_CLAUDE],
  })
  return handler(request, env, ctx)
}

// A cada renovação do token do Claude, confere se o acesso ao Google ainda
// vale e se a conta continua sendo a permitida. Se o Google disser que a
// autorização morreu, a concessão é revogada: o Claude pede um login novo
// sozinho, em vez de seguir com um token que só daria erro nas ferramentas.
// Uma falha passageira do Google não derruba nada.
export async function conferirNaRenovacao({ grantType, props, env }) {
  if (grantType !== 'refresh_token') return undefined
  if (!emailPermitidoNoConector(env, props?.email)) {
    throw new OAuthError('invalid_grant', { description: 'A conta não é mais a autorizada neste app.' })
  }
  try {
    await renovarAcesso(env, props.googleRefreshToken)
  } catch (err) {
    if (err.code === 'invalid_grant') {
      throw new OAuthError('invalid_grant', { description: 'O acesso ao Google foi revogado ou expirou.' })
    }
  }
  return undefined
}

// Um provider por endereço: o `resource` de cada token é a URL exata do /mcp
// (workers.dev, domínio próprio, localhost no wrangler dev), e um token
// emitido para um endereço não vale no outro.
const provedores = new Map()

export function provedorPara(origem) {
  if (!provedores.has(origem)) {
    provedores.set(
      origem,
      new OAuthProvider({
        apiRoute: ROTA_MCP,
        apiHandler: { fetch: servirMcp },
        defaultHandler: { fetch: paginasDoConector },
        authorizeEndpoint: '/authorize',
        tokenEndpoint: '/token',
        clientRegistrationEndpoint: '/register',
        resourceMetadata: { resource: `${origem}${ROTA_MCP}` },
        // O Claude se identifica por um documento publicado (CIMD) ou pelo
        // registro dinâmico; os dois ficam abertos.
        clientIdMetadataDocumentEnabled: true,
        tokenExchangeCallback: conferirNaRenovacao,
        onError: ({ status, code, internal }) => console.warn('conector oauth', status, code, internal?.reason || ''),
      })
    )
  }
  return provedores.get(origem)
}
