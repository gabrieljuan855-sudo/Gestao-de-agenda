// Worker do Gestão de Agenda.
//
// Ele continua servindo o site estático como antes; as rotas próprias usam
// o Gemini para interpretar texto em português: POST /api/parse (compromisso
// rápido, só criação), POST /api/command (comandos mais amplos — editar,
// excluir, confirmar presença) e POST /api/analyze-note (sugestões a partir
// de uma anotação). A chave do Gemini fica como segredo do Cloudflare e
// nunca chega ao navegador — é justamente por isso que essa parte roda no
// servidor.

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

function buildPrompt({ text, today, weekday, calendars }) {
  const lista = (calendars || [])
    .map((c) => `- ${c.name}${c.id ? ` (id: ${c.id})` : ''}`)
    .join('\n')

  return `Você interpreta anotações rápidas de agenda escritas em português do Brasil e devolve dados estruturados.

Hoje é ${weekday}, ${today}. Fuso: America/Sao_Paulo.

Agendas disponíveis:
${lista || '- (nenhuma informada)'}

Texto do usuário:
"""
${text}
"""

Responda SOMENTE com JSON, sem comentários, neste formato:
{
  "type": "event" | "task",
  "title": "título limpo, sem a data e sem a hora",
  "date": "AAAA-MM-DD ou null",
  "time": "HH:MM em 24h, ou null se não houver hora",
  "durationMinutes": número de minutos ou null,
  "calendarId": "id da agenda mais provável, ou null",
  "priority": "alta" | "media" | "baixa" | null
}

Regras:
- "event" quando houver hora marcada; "task" quando for algo a fazer sem hora.
- Mantenha o título como a pessoa escreveu, inclusive nomes próprios e preposições ("Reunião de equipe" continua "Reunião de equipe").
- Nunca deixe a data ou a hora dentro do título.
- Horas em português como "13h15", "14h", "8h30" equivalem a 13:15, 14:00 e 08:30.
- Um dia da semana sem data significa a próxima ocorrência a partir de hoje.
- Só sugira calendarId se o texto indicar claramente a qual agenda pertence; na dúvida, null.
- Se não houver duração explícita, devolva null em durationMinutes.
- Só devolva priority quando o texto indicar urgência ou prazo; caso contrário, null.`
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

const PRIORITIES = new Set(['alta', 'media', 'baixa'])

// A resposta vem de um modelo: nada aqui é confiável por definição, então cada
// campo é validado antes de virar um compromisso na agenda de alguém.
export function normalize(parsed) {
  const type = parsed?.type === 'event' ? 'event' : 'task'
  const title = typeof parsed?.title === 'string' ? parsed.title.trim().slice(0, 300) : ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed?.date || '') ? parsed.date : null
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(parsed?.time || '') ? parsed.time : null

  const minutes = Number(parsed?.durationMinutes)
  const durationMinutes = Number.isFinite(minutes) && minutes > 0 && minutes <= 12 * 60
    ? Math.round(minutes)
    : null

  return {
    type: time ? 'event' : type,
    title,
    date,
    time,
    durationMinutes,
    calendarId: typeof parsed?.calendarId === 'string' ? parsed.calendarId : null,
    // null quando o texto não indica urgência: o formulário é que escolhe o
    // padrão, em vez de o app inventar uma prioridade.
    priority: PRIORITIES.has(parsed?.priority) ? parsed.priority : null,
  }
}

const COMMAND_ACTIONS = new Set([
  'criar_evento',
  'criar_tarefa',
  'editar_evento',
  'excluir_evento',
  'editar_tarefa',
  'excluir_tarefa',
  'confirmar_presenca',
])
// Só duas opções — é o mesmo vocabulário binário que o app já usa para
// presença (ver TO_RSVP em calendarPrefs.js): não existe "talvez" por aqui.
const PRESENCES = new Set(['vou', 'nao'])

function buildCommandPrompt({ text, today, weekday, calendars }) {
  const lista = (calendars || [])
    .map((c) => `- ${c.name}${c.id ? ` (id: ${c.id})` : ''}`)
    .join('\n')

  return `Você interpreta comandos rápidos, em português do Brasil, sobre a agenda e as tarefas de alguém que trabalha com atendimento social/administrativo.

Hoje é ${weekday}, ${today}. Fuso: America/Sao_Paulo.

Agendas disponíveis:
${lista || '- (nenhuma informada)'}

Comando do usuário:
"""
${text}
"""

Responda SOMENTE com JSON, sem comentários, neste formato:
{
  "action": "criar_evento" | "criar_tarefa" | "editar_evento" | "excluir_evento" | "editar_tarefa" | "excluir_tarefa" | "confirmar_presenca" | "desconhecido",
  "searchText": "palavras para achar o compromisso/tarefa que já existe (trecho do título) — só quando a ação não for criar; senão null",
  "title": "título do evento/tarefa (para criar, ou o novo título ao renomear; senão null)",
  "date": "AAAA-MM-DD ou null",
  "time": "HH:MM em 24h, ou null",
  "durationMinutes": número de minutos ou null,
  "calendarId": "id da agenda mais provável, ou null",
  "priority": "alta" | "media" | "baixa" | null,
  "presence": "vou" | "nao" | null,
  "summary": "uma frase curta (até 15 palavras) confirmando o que vai acontecer, para mostrar para a pessoa antes de executar"
}

Regras:
- "criar_evento"/"criar_tarefa": pedir para agendar algo novo — "title" vem preenchido, "searchText" fica null. "criar_evento" quando houver hora marcada; "criar_tarefa" quando for algo a fazer sem hora.
- "editar_evento"/"editar_tarefa": mudar data, hora, duração ou título de algo que já existe ("mudar a reunião de terça para 15h", "renomear a tarefa X para Y") — "searchText" descreve o que já existe; só os campos que mudam vêm preenchidos, os outros ficam null.
- "excluir_evento"/"excluir_tarefa": "desmarcar", "cancelar" ou "excluir" algo que já existe — "searchText" descreve o que procurar.
- "confirmar_presenca": a pessoa diz que vai ou não vai a um compromisso já existente, sem querer excluí-lo ("não vou conseguir ir à reunião de amanhã" é presença "nao", não exclusão) — "searchText" descreve o compromisso, "presence" traz a resposta. Não existe "talvez" — só "vou" ou "nao".
- "desconhecido": o texto não dá para entender como nenhuma dessas ações — preencha "summary" explicando o que faltou entender.
- Um dia da semana sem data significa a próxima ocorrência a partir de hoje.
- Horas em português como "13h15", "14h" equivalem a 13:15, 14:00.
- Nunca deixe data ou hora dentro do título.
- Não invente um searchText genérico demais ("reunião" sozinho) quando o texto não especificar qual compromisso — use o pouco que tiver: a pessoa confirma antes de qualquer mudança acontecer de verdade.`
}

// Nada aqui é confiável por vir de um modelo — cada comando é validado, e a
// resolução de qual compromisso/tarefa de verdade corresponde ao searchText
// acontece no cliente, sobre os dados já carregados, nunca aqui.
export function normalizeCommand(parsed) {
  const action = COMMAND_ACTIONS.has(parsed?.action) ? parsed.action : 'desconhecido'
  const title = typeof parsed?.title === 'string' ? parsed.title.trim().slice(0, 300) : ''
  const searchText = typeof parsed?.searchText === 'string' ? parsed.searchText.trim().slice(0, 200) : ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed?.date || '') ? parsed.date : null
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(parsed?.time || '') ? parsed.time : null

  const minutes = Number(parsed?.durationMinutes)
  const durationMinutes = Number.isFinite(minutes) && minutes > 0 && minutes <= 12 * 60
    ? Math.round(minutes)
    : null

  return {
    action,
    searchText,
    title,
    date,
    time,
    durationMinutes,
    calendarId: typeof parsed?.calendarId === 'string' ? parsed.calendarId : null,
    priority: PRIORITIES.has(parsed?.priority) ? parsed.priority : null,
    presence: PRESENCES.has(parsed?.presence) ? parsed.presence : null,
    summary: typeof parsed?.summary === 'string' ? parsed.summary.trim().slice(0, 200) : '',
  }
}

async function handleCommand(request, env) {
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
  if (!text) return json({ error: 'Envie o comando.' }, 400)
  if (text.length > 500) return json({ error: 'Texto longo demais.' }, 400)

  try {
    const parsed = await callGemini(
      env,
      buildCommandPrompt({
        text,
        today: body.today,
        weekday: body.weekday,
        calendars: Array.isArray(body.calendars) ? body.calendars.slice(0, 20) : [],
      })
    )
    return json(normalizeCommand(parsed))
  } catch (err) {
    return json({ error: err.message }, 502)
  }
}

const SUGGESTION_TYPES = new Set(['evento', 'tarefa', 'documento', 'contato', 'caso'])

function buildAnalyzePrompt({ text, today, weekday }) {
  return `Você lê uma anotação livre (em português do Brasil, de alguém que trabalha com atendimento social/administrativo) e aponta o que ela sugere fazer.

Hoje é ${weekday}, ${today}. Fuso: America/Sao_Paulo.

Anotação:
"""
${text}
"""

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
  ]
}

Regras:
- "evento": algo com data/hora marcada ou implícita ("reunião quinta 14h").
- "tarefa": algo a fazer sem hora marcada ("ligar para X", "levar documento Y").
- "contato": precisa falar com alguém, mas a anotação não chega a virar uma tarefa clara sozinha.
- "caso": indica que um caso/atendimento em andamento precisa de um próximo passo.
- "documento": parece que vai precisar virar um documento/relatório escrito — não sugira data nem hora para este tipo.
- Só inclua "date"/"time" em "evento" e "tarefa", e só quando o texto realmente indicar quando.
- Nada de sugestão para anotações que são só um pensamento solto, sem nenhuma ação implícita — nesse caso "suggestions" pode vir vazio.
- Não invente informação que não está na anotação.
- No máximo 5 sugestões.`
}

// Nada aqui é confiável por vir de um modelo — cada sugestão é validada e
// as que não batem no formato esperado somem, em vez de quebrar a tela.
export function normalizeAnalysis(parsed) {
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
      }
    })
    .filter(Boolean)

  return { title, suggestions }
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

  try {
    const parsed = await callGemini(env, buildAnalyzePrompt({ text, today: body.today, weekday: body.weekday }))
    return json(normalizeAnalysis(parsed))
  } catch (err) {
    return json({ error: err.message }, 502)
  }
}

async function handleParse(request, env) {
  // Autenticação antes de tudo: quem não é dono não descobre nem como o
  // Worker está configurado.
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
  if (!text) return json({ error: 'Envie o texto a interpretar.' }, 400)
  if (text.length > 500) return json({ error: 'Texto longo demais.' }, 400)

  try {
    const parsed = await callGemini(
      env,
      buildPrompt({
        text,
        today: body.today,
        weekday: body.weekday,
        calendars: Array.isArray(body.calendars) ? body.calendars.slice(0, 20) : [],
      })
    )
    return json(normalize(parsed))
  } catch (err) {
    return json({ error: err.message }, 502)
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/auth/')) {
      return handleAuth(request, env, url.pathname)
    }

    if (url.pathname === '/api/parse') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
      return handleParse(request, env)
    }

    if (url.pathname === '/api/command') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
      return handleCommand(request, env)
    }

    if (url.pathname === '/api/analyze-note') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
      return handleAnalyzeNote(request, env)
    }

    return env.ASSETS.fetch(request)
  },
}
