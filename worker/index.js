// Worker do Gestão de Agenda.
//
// Ele continua servindo o site estático como antes; as rotas próprias usam
// o Gemini para interpretar texto em português: POST /api/esclarecer (lê um
// item da Entrada e propõe o que ele é), POST /api/briefing (resumo
// automático do dia/semana), POST /api/analyze-note (sugestões a partir de
// uma anotação) e POST /api/search-notes (responde uma pergunta usando as
// anotações existentes).
// A chave do Gemini fica como segredo do Cloudflare e nunca chega ao
// navegador — é justamente por isso que essa parte roda no servidor.

import { handleAuth } from './auth.js'

const TOKENINFO_URL = 'https://www.googleapis.com/oauth2/v3/tokeninfo'
// O Google aposenta modelo sem aviso: o gemini-2.0-flash passou a responder
// 404 pedindo para trocar. Por isso GEMINI_MODEL existe — dá para corrigir
// pelo painel, sem esperar um deploy.
const DEFAULT_MODEL = 'gemini-3.6-flash'

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

// Uma rota aberta que chama IA vira cota grátis para quem descobrir a URL.
// Só seguimos com um token do Google válido e, quando ALLOWED_EMAIL estiver
// configurado, apenas para essa conta.
async function verifyCaller(request, env) {
  const header = request.headers.get('Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return null

  const res = await fetch(`${TOKENINFO_URL}?access_token=${encodeURIComponent(token)}`)
  if (!res.ok) return null

  const info = await res.json()
  if (!info.email) return null
  if (env.ALLOWED_EMAIL && info.email.toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) return null
  return info
}

async function callGemini(env, prompt) {
  const model = env.GEMINI_MODEL || DEFAULT_MODEL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  })

  if (!res.ok) {
    const detail = await res.text()
    // 503 (sobrecarga) e 429 (limite de uso) são passageiros: o modelo
    // costuma voltar em segundos. Quem chama precisa saber disso para
    // decidir se vale tentar de novo em silêncio em vez de alarmar a
    // pessoa com um erro que se resolve sozinho.
    if (res.status === 503 || res.status === 429) {
      const limite = res.status === 429
      const err = new Error(
        limite
          ? 'A IA do Google atingiu o limite de uso por agora.'
          : 'A IA do Google está sobrecarregada agora.'
      )
      err.transiente = true
      // Os dois são passageiros, mas em escalas bem diferentes: sobrecarga
      // passa em segundos, cota estourada leva o resto da janela de cobrança.
      // Insistir num limite de cota só queima mais cota.
      err.motivo = limite ? 'limite' : 'sobrecarga'
      throw err
    }
    throw new Error(`Gemini respondeu ${res.status}: ${detail.slice(0, 300)}`)
  }

  const data = await res.json()
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!raw) throw new Error('Gemini não devolveu conteúdo.')

  try {
    return JSON.parse(raw)
  } catch {
    // Às vezes vem embrulhado em cerca de código, apesar do responseMimeType.
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Gemini não devolveu JSON válido.')
    return JSON.parse(match[0])
  }
}

// A resposta de erro das rotas de IA. `transiente` é o que permite ao app
// distinguir "tenta de novo daqui a pouco que passa" de "isso não vai se
// resolver sozinho" — sem essa marca, os dois viram o mesmo aviso vermelho.
function erroDeIA(err) {
  return json(
    { error: err.message, transiente: err.transiente === true, motivo: err.motivo || '' },
    502
  )
}

// ---------- Esclarecer ----------
//
// Esta rota substituiu o agente de conversa, e a diferença é de formato, não
// de capacidade.
//
// O agente recebia a agenda inteira de 30 dias, as tarefas e as anotações a
// cada mensagem — 7 a 25 mil caracteres por turno, reenviados de novo no
// turno seguinte — para que o modelo pudesse escolher *qual* item mexer. Era
// caro por causa disso, e toda a engenharia de referências curtas e validação
// existia para tornar essa escolha segura.
//
// Aqui a pessoa já escolheu o item: é o que está na frente dela, na Entrada.
// Então o prompt é só o texto dele mais a lista de contextos que ela já usa.
// Umas poucas centenas de caracteres, uma chamada, uma decisão.
const TIPOS_ESCLARECER = new Set(['acao', 'aguardando', 'agendar', 'algum_dia', 'referencia'])

function buildEsclarecerPrompt({ texto, contextos, today, weekday }) {
  const lista = (contextos || []).map((c) => `@${c}`).join(', ')
  return `Você ajuda alguém que trabalha com atendimento social/administrativo a processar a caixa de entrada dela, em português do Brasil. Cada item foi anotado às pressas e agora precisa virar uma coisa clara.

Hoje é ${weekday}, ${today}. Fuso: America/Sao_Paulo.

Item anotado:
"""
${texto}
"""

Contextos que ela já usa: ${lista || '(nenhum ainda)'}

Responda SOMENTE com JSON, sem comentários, neste formato:
{
  "tipo": "acao" | "aguardando" | "agendar" | "algum_dia" | "referencia",
  "titulo": "a próxima ação concreta, começando por um verbo no infinitivo",
  "contexto": "uma palavra só, sem @, do modo de fazer (ligar, computador, rua, conversar) — ou null",
  "quem": "de quem ela está esperando, quando o tipo for aguardando; senão null",
  "date": "AAAA-MM-DD, só quando o texto disser uma data de verdade; senão null",
  "time": "HH:MM em 24h, só quando houver hora marcada; senão null"
}

Regras:
- "acao": ela mesma precisa fazer algo. O título tem que ser a **menor ação física visível** — "Ligar para a escola sobre a vaga do João", não "Resolver escola". Se não dá para agir sem antes saber de outra coisa, a ação é descobrir essa coisa.
- "aguardando": ela já pediu e depende de outra pessoa. Preencha "quem".
- "agendar": tem dia e hora marcados, ou é algo que só pode acontecer num momento específico.
- "algum_dia": faria sentido um dia, mas não agora e sem prazo.
- "referencia": não pede ação nenhuma, é informação para guardar.
- Prefira um contexto que já esteja na lista acima; só invente outro se nenhum servir.
- NÃO invente nome de pessoa, data nem detalhe que não esteja no texto. Na dúvida, null.
- O título mantém as palavras da pessoa sempre que der; você está deixando claro, não reescrevendo.`
}

// Nada aqui é confiável por vir de um modelo — cada campo é validado antes de
// virar botão na tela, do mesmo jeito que as outras rotas fazem.
export function normalizeEsclarecer(parsed) {
  const tipo = TIPOS_ESCLARECER.has(parsed?.tipo) ? parsed.tipo : null
  const titulo = typeof parsed?.titulo === 'string' ? parsed.titulo.trim().slice(0, 300) : ''
  const contextoBruto = typeof parsed?.contexto === 'string' ? parsed.contexto.trim() : ''
  // Uma palavra só, sem acento nem espaço: é assim que o contexto é gravado
  // na etiqueta da nota (ver etiqueta() em gtd.js).
  const contexto =
    contextoBruto
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || null

  return {
    tipo,
    titulo,
    contexto,
    quem: tipo === 'aguardando' && typeof parsed?.quem === 'string' ? parsed.quem.trim().slice(0, 80) : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(parsed?.date || '') ? parsed.date : null,
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(parsed?.time || '') ? parsed.time : null,
  }
}

async function handleEsclarecer(request, env) {
  const caller = await verifyCaller(request, env)
  if (!caller) return json({ error: 'Não autorizado.' }, 401)

  if (!env.GEMINI_API_KEY) {
    return json({ error: 'GEMINI_API_KEY não está configurada neste Worker.' }, 503)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Corpo inválido.' }, 400)
  }

  const texto = typeof body?.texto === 'string' ? body.texto.trim() : ''
  if (!texto) return json({ error: 'Envie o item.' }, 400)
  if (texto.length > 500) return json({ error: 'Item longo demais.' }, 400)

  const contextos = (Array.isArray(body?.contextos) ? body.contextos.slice(0, 20) : [])
    .filter((c) => typeof c === 'string' && c.trim())
    .map((c) => c.trim().slice(0, 30))

  try {
    const parsed = await callGemini(
      env,
      buildEsclarecerPrompt({ texto, contextos, today: body.today, weekday: body.weekday })
    )
    return json(normalizeEsclarecer(parsed))
  } catch (err) {
    return erroDeIA(err)
  }
}

const BRIEFING_KINDS = new Set(['dia_manha', 'dia_tarde', 'dia_recap', 'semana_inicio', 'semana_fim'])

const BRIEFING_INTRO = {
  dia_manha: 'Escreva um briefing curto para o início do dia de alguém que trabalha com atendimento social/administrativo, olhando para os compromissos e tarefas de hoje.',
  dia_tarde: 'Escreva um briefing curto para o início da tarde, olhando para o que ainda falta hoje (o que já passou da manhã não precisa ser repetido).',
  dia_recap: 'Escreva um resumo curto do que essa pessoa fez ao longo do dia (tarefas concluídas, blocos de foco, compromissos).',
  semana_inicio: 'Escreva um briefing curto do que está previsto para a semana inteira que está começando.',
  semana_fim: 'Escreva um resumo curto (vai acompanhar um painel com números) do que aconteceu ao longo da semana que está terminando.',
}

function buildBriefingPrompt({ kind, today, weekday, context }) {
  const intro = BRIEFING_INTRO[kind] || BRIEFING_INTRO.dia_manha
  return `${intro}

Hoje é ${weekday}, ${today}. Fuso: America/Sao_Paulo. Em português do Brasil.

Dados (JSON, já resumidos):
${JSON.stringify(context ?? {})}

Responda SOMENTE com JSON, sem comentários, neste formato:
{ "text": "o briefing, em até 60 palavras" }

Regras:
- Tom direto e acolhedor, não robótico.
- Sem saudação ("bom dia", "boa tarde" etc.) — isso já aparece em outro lugar da tela.
- Resuma, não liste item a item como uma agenda — quem quiser o detalhe abre a tela normal.
- Se os dados trouxerem minutos ou blocos de foco (tempo de trabalho concentrado, sem interrupção), comente isso brevemente — é um número que a pessoa não vê em nenhum outro lugar do app.
- Se os dados vierem vazios ou sem nada relevante, diga isso em uma frase curta, sem inventar compromisso ou tarefa nenhuma.`
}

// Nada aqui é confiável por vir de um modelo — o texto é validado e cortado
// antes de aparecer na tela.
export function normalizeBriefing(parsed) {
  const text = typeof parsed?.text === 'string' ? parsed.text.trim().slice(0, 600) : ''
  return { text }
}

async function handleBriefing(request, env) {
  const caller = await verifyCaller(request, env)
  if (!caller) return json({ error: 'Não autorizado.' }, 401)

  if (!env.GEMINI_API_KEY) {
    return json({ error: 'GEMINI_API_KEY não está configurada neste Worker.' }, 503)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Corpo inválido.' }, 400)
  }

  const kind = BRIEFING_KINDS.has(body?.kind) ? body.kind : null
  if (!kind) return json({ error: 'Tipo de briefing inválido.' }, 400)

  try {
    const parsed = await callGemini(
      env,
      buildBriefingPrompt({ kind, today: body.today, weekday: body.weekday, context: body.context })
    )
    return json(normalizeBriefing(parsed))
  } catch (err) {
    return erroDeIA(err)
  }
}

const SUGGESTION_TYPES = new Set(['evento', 'tarefa', 'documento', 'contato', 'caso'])

// Telefone e e-mail nunca vêm do modelo: são dados exatos, e é justamente o
// tipo de coisa que uma IA generativa pode trocar um dígito sem avisar. Uma
// expressão regular sobre o texto original da anotação não erra.
const PHONE_REGEX = /(?:\+55\s?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/
const EMAIL_REGEX = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+[a-zA-Z]/

function extractContact(notaTexto) {
  const phone = notaTexto.match(PHONE_REGEX)?.[0]?.trim() || null
  const email = notaTexto.match(EMAIL_REGEX)?.[0] || null
  return { phone, email }
}

// Anotações entram numeradas (n1, n2...), no mesmo esquema de referência
// curta do agente (ver refDeNota em agentActions.js) — usado tanto para
// apontar uma nota relacionada quanto para a busca por pergunta, e é contra
// essa mesma lista que a normalização de cada rota confere o que o modelo
// devolveu, para nunca aceitar uma referência inventada.
function linhasDeNotas(notas) {
  return (notas || [])
    .map((n, i) => `n${i + 1}: ${n?.titulo || '(sem título)'}${n?.trecho ? ` — ${n.trecho}` : ''}`)
    .join('\n')
}

// Sanitiza a lista de anotações que o cliente manda (nunca a nota inteira,
// só título e um trecho curto) antes de entrar em qualquer prompt.
function sanitizarNotas(notas, max) {
  return (Array.isArray(notas) ? notas.slice(0, max) : []).map((n) => ({
    titulo: typeof n?.titulo === 'string' ? n.titulo.trim().slice(0, 80) : '',
    trecho: typeof n?.trecho === 'string' ? n.trecho.trim().slice(0, 200) : '',
  }))
}

// As referências que uma resposta pode citar de verdade são só as que
// realmente apareceram na lista mandada. Aceitar uma referência inventada
// levaria a pessoa para a anotação errada ao clicar.
function refsValidas(brutas, notasCount) {
  const vistas = new Set()
  const validas = []
  for (const ref of Array.isArray(brutas) ? brutas : []) {
    if (typeof ref !== 'string') continue
    const r = ref.trim()
    if (!/^n\d+$/.test(r)) continue
    const indice = Number(r.slice(1))
    if (indice < 1 || indice > notasCount || vistas.has(r)) continue
    vistas.add(r)
    validas.push(r)
  }
  return validas
}

function buildAnalyzePrompt({ text, today, weekday, notas }) {
  const outras = linhasDeNotas(notas)
  return `Você lê uma anotação livre (em português do Brasil, de alguém que trabalha com atendimento social/administrativo) e aponta o que ela sugere fazer.

Hoje é ${weekday}, ${today}. Fuso: America/Sao_Paulo.

Anotação:
"""
${text}
"""

OUTRAS ANOTAÇÕES já existentes (só para você notar se a de agora se relaciona com alguma):
${outras || '(nenhuma outra anotação)'}

Responda SOMENTE com JSON, sem comentários, neste formato:
{
  "title": "título curto (até 6 palavras) que resuma a anotação inteira",
  "suggestions": [
    {
      "type": "evento" | "tarefa" | "documento" | "contato" | "caso",
      "text": "frase curta explicando a sugestão, para mostrar na tela",
      "title": "título pronto para criar o evento/tarefa (só quando fizer sentido; senão null)",
      "date": "AAAA-MM-DD ou null",
      "time": "HH:MM em 24h, ou null se não houver hora"
    }
  ],
  "notaRelacionadaRef": "a referência (n1, n2...) de uma outra anotação claramente sobre o mesmo caso/assunto, ou null"
}

Regras:
- "evento": algo com data/hora marcada ou implícita ("reunião quinta 14h").
- "tarefa": algo a fazer sem hora marcada ("ligar para X", "levar documento Y").
- "contato": precisa falar com alguém, mas a anotação não chega a virar uma tarefa clara sozinha.
- "caso": indica que um caso/atendimento em andamento precisa de um próximo passo.
- "documento": parece que vai precisar virar um documento/relatório escrito — não sugira data nem hora para este tipo.
- Só inclua "date"/"time" em "evento" e "tarefa", e só quando o texto realmente indicar quando.
- Nada de sugestão para anotações que são só um pensamento solto, sem nenhuma ação implícita — nesse caso "suggestions" pode vir vazio.
- "notaRelacionadaRef": só preencha quando a relação for forte e óbvia (mesmo caso, mesma pessoa, mesmo assunto claramente contínuo) — na dúvida, deixe null. NUNCA invente uma referência que não esteja na lista de outras anotações.
- Não invente informação que não está na anotação.
- No máximo 5 sugestões.`
}

// Nada aqui é confiável por vir de um modelo — cada sugestão é validada e
// as que não batem no formato esperado somem, em vez de quebrar a tela.
// `text` é o corpo original da anotação (não a frase curta que o modelo
// escreveu) — é nele que extractContact procura telefone/e-mail de verdade.
// `notasCount` é quantas outras anotações foram oferecidas no prompt: contra
// esse número se confere "notaRelacionadaRef", para o modelo não apontar uma
// anotação que nunca esteve na lista.
export function normalizeAnalysis(parsed, { text: notaTexto = '', notasCount = 0 } = {}) {
  const title = typeof parsed?.title === 'string' ? parsed.title.trim().slice(0, 80) : ''
  const rawSuggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions.slice(0, 5) : []

  const suggestions = rawSuggestions
    .map((s) => {
      const type = SUGGESTION_TYPES.has(s?.type) ? s.type : null
      const text = typeof s?.text === 'string' ? s.text.trim().slice(0, 300) : ''
      if (!type || !text) return null
      const date = /^\d{4}-\d{2}-\d{2}$/.test(s?.date || '') ? s.date : null
      const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(s?.time || '') ? s.time : null
      const suggestedTitle = typeof s?.title === 'string' ? s.title.trim().slice(0, 300) : ''
      return {
        type,
        text,
        title: suggestedTitle || text,
        // Data/hora só fazem sentido para o que vira compromisso ou tarefa.
        date: type === 'evento' || type === 'tarefa' ? date : null,
        time: type === 'evento' ? time : null,
        // Só "contato" ganha telefone/e-mail — nos outros tipos não fazem sentido.
        ...(type === 'contato' ? extractContact(notaTexto) : {}),
      }
    })
    .filter(Boolean)

  const refBruta = typeof parsed?.notaRelacionadaRef === 'string' ? parsed.notaRelacionadaRef.trim() : ''
  const indiceRelacionada = /^n\d+$/.test(refBruta) ? Number(refBruta.slice(1)) : 0
  const notaRelacionadaRef = indiceRelacionada >= 1 && indiceRelacionada <= notasCount ? refBruta : null

  return { title, suggestions, notaRelacionadaRef }
}

async function handleAnalyzeNote(request, env) {
  const caller = await verifyCaller(request, env)
  if (!caller) return json({ error: 'Não autorizado.' }, 401)

  if (!env.GEMINI_API_KEY) {
    return json({ error: 'GEMINI_API_KEY não está configurada neste Worker.' }, 503)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Corpo inválido.' }, 400)
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) return json({ error: 'Envie o texto da anotação.' }, 400)
  // Uma anotação é bem mais longa que o texto de /api/parse, mas ainda
  // precisa de um teto — sem ele, uma nota gigante vira um custo de IA fora
  // de controle por uma única gravação.
  if (text.length > 6000) return json({ error: 'Anotação longa demais para analisar de uma vez.' }, 400)

  // As outras anotações vêm já resumidas do cliente (nunca a lista completa
  // e crua) — mesmo espírito de recortarContexto no agente.
  const notas = sanitizarNotas(body?.notas, 30)

  try {
    const parsed = await callGemini(env, buildAnalyzePrompt({ text, today: body.today, weekday: body.weekday, notas }))
    return json(normalizeAnalysis(parsed, { text, notasCount: notas.length }))
  } catch (err) {
    return erroDeIA(err)
  }
}

const MAX_NOTAS_BUSCA = 60

function buildSearchPrompt({ query, today, weekday, notas }) {
  const lista = linhasDeNotas(notas)
  return `Você responde perguntas sobre as anotações pessoais de alguém que trabalha com atendimento social/administrativo, em português do Brasil, usando só o que está nelas.

Hoje é ${weekday}, ${today}. Fuso: America/Sao_Paulo.

ANOTAÇÕES (use a referência à esquerda para citar qual usou):
${lista || '(nenhuma anotação ainda)'}

Pergunta da pessoa:
"""
${query}
"""

Responda SOMENTE com JSON, sem comentários, neste formato:
{
  "answer": "a resposta, em até 80 palavras, em português",
  "refs": ["as referências (n1, n3...) das anotações que você realmente usou para responder"]
}

Regras:
- Responda só com o que está nas anotações listadas. Se não encontrar nada relevante, diga isso em "answer" e deixe "refs" vazio — nunca invente conteúdo de anotação nenhuma.
- NUNCA cite uma referência que não esteja na lista acima.
- No máximo 8 referências.`
}

// Nada aqui é confiável por vir de um modelo — "refs" só sobrevive se
// realmente estiver entre as anotações que foram oferecidas no prompt.
export function normalizeSearch(parsed, { notasCount = 0 } = {}) {
  const answer = typeof parsed?.answer === 'string' ? parsed.answer.trim().slice(0, 600) : ''
  const refs = refsValidas(parsed?.refs, notasCount).slice(0, 8)
  return { answer, refs }
}

async function handleSearchNotes(request, env) {
  const caller = await verifyCaller(request, env)
  if (!caller) return json({ error: 'Não autorizado.' }, 401)

  if (!env.GEMINI_API_KEY) {
    return json({ error: 'GEMINI_API_KEY não está configurada neste Worker.' }, 503)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Corpo inválido.' }, 400)
  }

  const query = typeof body?.query === 'string' ? body.query.trim() : ''
  if (!query) return json({ error: 'Envie a pergunta.' }, 400)
  if (query.length > 300) return json({ error: 'Pergunta longa demais.' }, 400)

  const notas = sanitizarNotas(body?.notas, MAX_NOTAS_BUSCA)
  if (notas.length === 0) return json({ error: 'Não há anotações para buscar ainda.' }, 400)

  try {
    const parsed = await callGemini(env, buildSearchPrompt({ query, today: body.today, weekday: body.weekday, notas }))
    return json(normalizeSearch(parsed, { notasCount: notas.length }))
  } catch (err) {
    return erroDeIA(err)
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/auth/')) {
      return handleAuth(request, env, url.pathname)
    }

    if (url.pathname === '/api/esclarecer') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
      return handleEsclarecer(request, env)
    }

    if (url.pathname === '/api/briefing') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
      return handleBriefing(request, env)
    }

    if (url.pathname === '/api/analyze-note') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
      return handleAnalyzeNote(request, env)
    }

    if (url.pathname === '/api/search-notes') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
      return handleSearchNotes(request, env)
    }

    return env.ASSETS.fetch(request)
  },
}
