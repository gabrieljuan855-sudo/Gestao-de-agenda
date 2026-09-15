// Worker do Gestão de Agenda.
//
// Ele continua servindo o site estático como antes; a única rota própria é
// POST /api/parse, que interpreta texto livre em português usando o Gemini.
// A chave do Gemini fica como segredo do Cloudflare e nunca chega ao
// navegador — é justamente por isso que essa parte roda no servidor.

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
  "priority": "urgente" | "importante" | "pode_esperar"
}

Regras:
- "event" quando houver hora marcada; "task" quando for algo a fazer sem hora.
- Mantenha o título como a pessoa escreveu, inclusive nomes próprios e preposições ("Reunião de equipe" continua "Reunião de equipe").
- Nunca deixe a data ou a hora dentro do título.
- Horas em português como "13h15", "14h", "8h30" equivalem a 13:15, 14:00 e 08:30.
- Um dia da semana sem data significa a próxima ocorrência a partir de hoje.
- Só sugira calendarId se o texto indicar claramente a qual agenda pertence; na dúvida, null.
- Se não houver duração explícita, devolva null em durationMinutes.`
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

const PRIORITIES = new Set(['urgente', 'importante', 'pode_esperar'])

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
    priority: PRIORITIES.has(parsed?.priority) ? parsed.priority : 'pode_esperar',
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

    if (url.pathname === '/api/parse') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
      return handleParse(request, env)
    }

    return env.ASSETS.fetch(request)
  },
}
