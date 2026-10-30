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
  const { state, headers } = await oauth.beginUpstream(aprovado.request, { data: { verifier }, headers: aprovado.headers })
  headers.set('Location', await urlDoGoogle(env, { redirectUri: new URL(ROTA_CALLBACK, request.url).toString(), state, verifier }))
  return new Response(null, { status: 302, headers })
}

// A volta do Google: troca o código, confere a conta e conclui a autorização.
async function voltaDoGoogle(request, env) {
  const oauth = env.OAUTH_PROVIDER
  const { request: pedido, data, headers } = await oauth.finishUpstream(request)
  const url = new URL(request.url)
  const negar = (descricao) => {
    headers.set('Location', authorizationErrorRedirect(pedido, 'access_denied', descricao))
    return new Response(null, { status: 302, headers })
  }
  if (url.searchParams.get('error')) return negar('O acesso foi recusado na tela do Google.')

  let tokens
  try {
    tokens = await trocarCodigo(env, {
      code: url.searchParams.get('code') || '',
      redirectUri: new URL(ROTA_CALLBACK, request.url).toString(),
      verifier: data?.verifier,
    })
  } catch (err) {
    return negar(`O Google não completou o login: ${err.message}`)
  }
  if (!tokens.refresh_token) return negar('O Google não enviou o acesso permanente (refresh token).')

  // O app é pessoal: a conta precisa ser exatamente a de ALLOWED_EMAIL.
  const email = await emailDaConta(tokens.access_token)
  if (!emailPermitidoNoConector(env, email)) {
    return erroLocal(
      'Conta não autorizada',
      `${email ? `A conta ${email}` : 'Esta conta'} não é a dona deste Segundo Cérebro. Volte ao Claude e conecte de novo, entrando com a conta autorizada.`,
      403
    )
  }

  const { redirectTo } = await oauth.completeAuthorization({
    request: pedido,
    // O id do usuário não pode ter ":" (o provider usa o caractere como
    // separador); e-mail não tem, mas codificar deixa isso garantido.
    userId: encodeURIComponent(email.toLowerCase()),
    metadata: { email },
    scope: pedido.scope,
    props: { email, googleRefreshToken: tokens.refresh_token, escopos: tokens.scope || '' },
  })
  headers.set('Location', redirectTo)
  return new Response(null, { status: 302, headers })
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
async function servirMcp(request, env, ctx) {
  if (!conectorConfigurado(env) || !emailPermitidoNoConector(env, ctx.props?.email)) {
    return new Response(JSON.stringify({ error: 'Conector desativado ou conta não autorizada.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
  const handler = createMcpHandler(() => criarServidor(env, ctx.props), { route: ROTA_MCP })
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
