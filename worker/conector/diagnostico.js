// O registro do que o conector respondeu, para entender uma conexão que
// falha do lado do Claude. O app do Claude só mostra "Algo deu errado", o
// painel da Cloudflare não está ao alcance de quem mantém o código, e cada
// tentativa às cegas custava um deploy e uma nova rodada no iPhone. Aqui fica,
// por dois dias, o caminho, o status e o motivo de cada resposta do conector.
//
// Nunca entra segredo: a query (onde viajam o `code` e o `state`) é
// descartada, e do corpo só se guardam as mensagens de erro, que são nossas
// ou da biblioteca. A leitura exige uma chave cujo hash está abaixo.

const PREFIXO = 'conector-diag:'
const VALIDADE_S = 2 * 24 * 60 * 60
const HASH_DA_CHAVE = '301bb0a8a85364f81ec7cc3f410792b715c1433ccfc160a5aca875d564a95479'
export const ROTA_DO_DIAGNOSTICO = '/conector/diagnostico'

async function sha256(texto) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Para onde um redirecionamento mandou, sem o código nem o state: só o
// endereço e, se houver, o erro que foi junto.
function destinoSemSegredo(location) {
  try {
    const u = new URL(location)
    const erro = u.searchParams.get('error')
    return { destino: `${u.origin}${u.pathname}`, ...(erro ? { erro, motivo: u.searchParams.get('error_description') || '' } : {}) }
  } catch {
    return {}
  }
}

// De onde o pedido veio, sem a query (que pode levar o code e o state).
function origemDoReferer(referer) {
  try {
    const u = new URL(referer)
    return `${u.origin}${u.pathname}`
  } catch {
    return ''
  }
}

// O método JSON-RPC de um pedido ao /mcp ("initialize", "tools/list"...).
export async function metodoDoMcp(request) {
  if (request.method !== 'POST') return ''
  try {
    const corpo = await request.json()
    return Array.isArray(corpo) ? corpo.map((m) => m?.method).join(',') : corpo?.method || ''
  } catch {
    return ''
  }
}

// O resumo de uma resposta; null quando não vale guardar (as chamadas de
// ferramenta que deram certo, que são a maioria e não explicam nada).
export async function resumoDaResposta({ request, response, metodo = '' }) {
  const { pathname } = new URL(request.url)
  const ehMcp = pathname.startsWith('/mcp')
  if (ehMcp && response.status < 400 && metodo !== 'initialize') return null
  const resumo = {
    quando: new Date().toISOString(),
    metodo: request.method,
    caminho: pathname,
    status: response.status,
    ...(metodo ? { mcp: metodo } : {}),
    ...(request.headers.get('origin') ? { origem: request.headers.get('origin') } : {}),
    ...(request.headers.get('authorization') ? { comToken: true } : {}),
    ...(request.headers.get('sec-fetch-site') ? { site: request.headers.get('sec-fetch-site') } : {}),
    // Navegação de verdade ou pedido em segundo plano (fetch), se foi toque
    // da pessoa, e se o cookie da tela de consentimento veio junto: é o que
    // separa o pedido real das repetições do navegador embutido do Claude.
    ...(request.headers.get('sec-fetch-mode') ? { modo: request.headers.get('sec-fetch-mode') } : {}),
    ...(request.headers.get('sec-fetch-dest') ? { alvo: request.headers.get('sec-fetch-dest') } : {}),
    ...(request.headers.get('sec-fetch-user') ? { toque: request.headers.get('sec-fetch-user') } : {}),
    cookieDaTela: /__Host-oauth-/.test(request.headers.get('cookie') || ''),
    ...(origemDoReferer(request.headers.get('referer')) ? { vindoDe: origemDoReferer(request.headers.get('referer')) } : {}),
    agente: (request.headers.get('user-agent') || '').slice(0, 120),
  }
  const location = response.headers.get('location')
  if (location) Object.assign(resumo, destinoSemSegredo(location))
  if (response.status >= 400) {
    const texto = await response.clone().text().catch(() => '')
    // Título e explicação da página de erro (o detalhe da biblioteca vem no
    // parágrafo, entre parênteses).
    const titulo = texto.match(/<h1>([^<]*)<\/h1>/)?.[1]
    const explicacao = texto.match(/<\/h1><p>([^<]*)<\/p>/)?.[1]
    resumo.resposta = (titulo ? `${titulo}${explicacao ? ` — ${explicacao}` : ''}` : texto).slice(0, 400)
  }
  return resumo
}

export async function registrar(kv, resumo) {
  if (!kv || !resumo) return
  const id = `${PREFIXO}${resumo.quando}:${crypto.randomUUID().slice(0, 8)}`
  await kv.put(id, JSON.stringify(resumo), { expirationTtl: VALIDADE_S })
}

export async function lerDiagnostico(request, kv) {
  const chave = new URL(request.url).searchParams.get('chave') || ''
  if (!chave || (await sha256(chave)) !== HASH_DA_CHAVE) return new Response('Não encontrado', { status: 404 })
  const { keys } = await kv.list({ prefix: PREFIXO })
  const eventos = await Promise.all(keys.map((k) => kv.get(k.name, 'json')))
  return new Response(JSON.stringify(eventos.filter(Boolean).sort((a, b) => a.quando.localeCompare(b.quando)), null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
