// Worker do Gestão de Agenda.
//
// Ele continua servindo o site estático como antes; as rotas próprias usam
// o Claude (Anthropic) para interpretar texto em português: POST /api/agent
// (o agente que conversa e propõe ações sobre a agenda, as tarefas e as
// anotações), POST /api/briefing (resumo automático do dia/semana) e POST
// /api/analyze-note (sugestões a partir de uma anotação).
// A chave da Anthropic fica como segredo do Cloudflare e nunca chega ao
// navegador — é justamente por isso que essa parte roda no servidor.

import Anthropic from '@anthropic-ai/sdk'
import { handleAuth } from './auth.js'

const TOKENINFO_URL = 'https://www.googleapis.com/oauth2/v3/tokeninfo'
// A Anthropic aposenta modelo com aviso, mas ainda assim dá para trocar sem
// esperar um deploy — por isso CLAUDE_MODEL existe, corrigível pelo painel.
const DEFAULT_MODEL = 'claude-opus-5'

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

async function callClaude(env, prompt) {
  const model = env.CLAUDE_MODEL || DEFAULT_MODEL
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  let response
  try {
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      // Extração/classificação simples não precisa do esforço máximo — e
      // gasta bem menos por chamada, o que importa numa rota chamada a
      // cada mensagem do agente.
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    // 429 (limite de uso) e 529 (sobrecarga) são passageiros: o modelo
    // costuma voltar em segundos. Quem chama precisa saber disso para
    // decidir se vale tentar de novo em silêncio em vez de alarmar a
    // pessoa com um erro que se resolve sozinho.
    if (err instanceof Anthropic.RateLimitError || err.status === 529) {
      const limite = err instanceof Anthropic.RateLimitError
      const transiente = new Error(
        limite
          ? 'A IA da Anthropic atingiu o limite de uso por agora.'
          : 'A IA da Anthropic está sobrecarregada agora.'
      )
      transiente.transiente = true
      // Os dois são passageiros, mas em escalas bem diferentes: sobrecarga
      // passa em segundos, cota estourada leva o resto da janela de cobrança.
      // Insistir num limite de cota só queima mais cota.
      transiente.motivo = limite ? 'limite' : 'sobrecarga'
      throw transiente
    }
    throw new Error(`Claude respondeu com erro: ${err.message}`)
  }

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude recusou a resposta.')
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  const raw = textBlock?.text
  if (!raw) throw new Error('Claude não devolveu conteúdo.')

  try {
    return JSON.parse(raw)
  } catch {
    // Às vezes vem embrulhado em cerca de código, apesar de pedirmos só JSON.
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Claude não devolveu JSON válido.')
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

const PRIORITIES = new Set(['alta', 'media', 'baixa'])

// Só duas opções — é o mesmo vocabulário binário que o app já usa para
// presença (ver TO_RSVP em calendarPrefs.js): não existe "talvez" por aqui.
const PRESENCES = new Set(['vou', 'nao'])

// O agente: diferente de /api/command, ele enxerga a agenda, as tarefas e as
// anotações antes de decidir, conversa em várias rodadas e pode propor mais de
// uma ação de uma vez. Nada do que ele propõe é executado aqui — quem executa
// é o cliente, e só depois de a pessoa aprovar.
const AGENT_ACTIONS = new Set([
  'criar_evento',
  'criar_tarefa',
  'editar_evento',
  'excluir_evento',
  'editar_tarefa',
  'excluir_tarefa',
  'concluir_tarefa',
  'confirmar_presenca',
])

// Quais ações mexem num item que já existe (e portanto exigem uma referência
// válida), e de que tipo tem que ser essa referência. Sem esta tabela, um
// "editar_tarefa" apontando para uma referência de evento passaria batido e o
// cliente tentaria gravar um patch de tarefa num compromisso.
const AGENT_REF_KIND = {
  editar_evento: 'e',
  excluir_evento: 'e',
  confirmar_presenca: 'e',
  editar_tarefa: 't',
  excluir_tarefa: 't',
  concluir_tarefa: 't',
}

const MAX_ACOES = 8

function linhasDoContexto(context) {
  const eventos = (context?.eventos || [])
    .map((e) => `${e.ref}: ${e.titulo} — ${e.dia}${e.hora ? ` ${e.hora}` : ' (dia inteiro)'}${e.agenda ? ` [${e.agenda}]` : ''}`)
    .join('\n')
  const tarefas = (context?.tarefas || [])
    .map((t) => `${t.ref}: ${t.titulo}${t.prazo ? ` — prazo ${t.prazo}` : ''}${t.prioridade ? ` (${t.prioridade})` : ''}`)
    .join('\n')
  const notas = (context?.notas || [])
    .map((n) => `${n.ref}: ${n.titulo}${n.trecho ? ` — ${n.trecho}` : ''}`)
    .join('\n')
  return { eventos, tarefas, notas }
}

function buildAgentPrompt({ text, today, weekday, history, context }) {
  const { eventos, tarefas, notas } = linhasDoContexto(context)
  const agendas = (context?.calendars || [])
    .map((c) => `- ${c.name}${c.id ? ` (id: ${c.id})` : ''}`)
    .join('\n')
  const conversa = (history || [])
    .map((m) => `${m.role === 'user' ? 'Pessoa' : 'Você'}: ${m.text}`)
    .join('\n')

  return `Você é o assistente de agenda de alguém que trabalha com atendimento social/administrativo, em português do Brasil. Você conversa e propõe ações sobre a agenda e as tarefas dela.

Hoje é ${weekday}, ${today}. Fuso: America/Sao_Paulo.

Agendas disponíveis:
${agendas || '- (nenhuma informada)'}

COMPROMISSOS (use a referência à esquerda para se referir a eles):
${eventos || '(nenhum no período que você enxerga)'}

TAREFAS PENDENTES:
${tarefas || '(nenhuma)'}

ANOTAÇÕES (somente leitura — você pode usar como contexto, mas não pode criar nem editar anotação):
${notas || '(nenhuma)'}
${conversa ? `\nConversa até agora:\n${conversa}\n` : ''}
Mensagem nova da pessoa:
"""
${text}
"""

Responda SOMENTE com JSON, sem comentários, neste formato:
{
  "reply": "sua resposta em conversa, até 60 palavras",
  "actions": [
    {
      "action": "criar_evento" | "criar_tarefa" | "editar_evento" | "excluir_evento" | "editar_tarefa" | "excluir_tarefa" | "concluir_tarefa" | "confirmar_presenca",
      "ref": "a referência (e1, t2...) do item que já existe — obrigatória em tudo que não for criar; null ao criar",
      "title": "título (ao criar, ou o novo título ao renomear; senão null)",
      "date": "AAAA-MM-DD ou null",
      "time": "HH:MM em 24h, ou null",
      "durationMinutes": número de minutos ou null,
      "calendarId": "id da agenda, ou null",
      "priority": "alta" | "media" | "baixa" | null,
      "presence": "vou" | "nao" | null,
      "resumo": "frase curta (até 12 palavras) do que essa ação faz, para a pessoa ler antes de aprovar"
    }
  ]
}

Regras:
- "actions" pode vir vazio: quando a pessoa só faz uma pergunta ("o que tenho amanhã?"), responda em "reply" e não proponha ação nenhuma.
- NUNCA invente uma referência. Só use referências que aparecem nas listas acima. Se a pessoa pedir algo sobre um item que você não encontra nas listas, diga isso em "reply" e não proponha a ação.
- Você enxerga um período limitado. Se o que ela pede pode estar fora dele, diga isso em vez de chutar.
- Ao criar, "ref" é null e "title" vem preenchido. "criar_evento" quando houver hora; "criar_tarefa" quando não houver.
- Ao editar, preencha só os campos que mudam; o resto fica null.
- "concluir_tarefa": a pessoa diz que já fez algo ("terminei o relatório").
- "confirmar_presenca": ela diz que vai ou não vai a um compromisso, sem querer excluí-lo. Só "vou" ou "nao".
- Nunca deixe data ou hora dentro do título.
- Horas em português como "13h15", "14h" equivalem a 13:15, 14:00.
- No máximo ${MAX_ACOES} ações. Se o pedido exigir mais, faça as mais importantes e diga em "reply" o que ficou de fora.`
}

// Nada aqui é confiável por vir de um modelo. Além de validar campo a campo
// como as outras rotas, esta confere cada referência contra o conjunto que o
// próprio prompt ofereceu: uma ação apontando para um item que não foi
// mostrado é descartada, porque executá-la significaria mexer num compromisso
// que ninguém escolheu.
export function normalizeAgent(parsed, { refs = [] } = {}) {
  const conhecidas = new Set(refs)
  const reply = typeof parsed?.reply === 'string' ? parsed.reply.trim().slice(0, 400) : ''
  const brutas = Array.isArray(parsed?.actions) ? parsed.actions.slice(0, MAX_ACOES) : []

  let descartadas = 0
  const actions = []
  for (const bruta of brutas) {
    const action = AGENT_ACTIONS.has(bruta?.action) ? bruta.action : null
    if (!action) {
      descartadas++
      continue
    }

    const title = typeof bruta?.title === 'string' ? bruta.title.trim().slice(0, 300) : ''
    const criar = action === 'criar_evento' || action === 'criar_tarefa'
    if (criar && !title) {
      descartadas++
      continue
    }

    const ref = typeof bruta?.ref === 'string' ? bruta.ref.trim() : ''
    if (!criar) {
      const esperado = AGENT_REF_KIND[action]
      if (!ref || !conhecidas.has(ref) || !ref.startsWith(esperado)) {
        descartadas++
        continue
      }
    }

    const minutes = Number(bruta?.durationMinutes)
    const durationMinutes = Number.isFinite(minutes) && minutes > 0 && minutes <= 12 * 60
      ? Math.round(minutes)
      : null

    actions.push({
      // O id é do servidor, nunca do modelo: é por ele que o cliente aprova
      // uma ação específica, e um id repetido pelo modelo aprovaria a errada.
      id: `a${actions.length + 1}`,
      action,
      ref: criar ? null : ref,
      title,
      date: /^\d{4}-\d{2}-\d{2}$/.test(bruta?.date || '') ? bruta.date : null,
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(bruta?.time || '') ? bruta.time : null,
      durationMinutes,
      calendarId: typeof bruta?.calendarId === 'string' ? bruta.calendarId : null,
      priority: PRIORITIES.has(bruta?.priority) ? bruta.priority : null,
      presence: PRESENCES.has(bruta?.presence) ? bruta.presence : null,
      resumo: typeof bruta?.resumo === 'string' ? bruta.resumo.trim().slice(0, 200) : '',
    })
  }

  return { reply, actions, descartadas }
}

// As referências que o prompt realmente ofereceu. É contra esta lista que
// normalizeAgent confere o que o modelo devolveu.
function refsDoContexto(context) {
  return [
    ...(context?.eventos || []).map((e) => e?.ref),
    ...(context?.tarefas || []).map((t) => t?.ref),
  ].filter((r) => typeof r === 'string' && r)
}

function recortarContexto(context) {
  return {
    calendars: Array.isArray(context?.calendars) ? context.calendars.slice(0, 20) : [],
    eventos: Array.isArray(context?.eventos) ? context.eventos.slice(0, 60) : [],
    tarefas: Array.isArray(context?.tarefas) ? context.tarefas.slice(0, 60) : [],
    notas: Array.isArray(context?.notas) ? context.notas.slice(0, 30) : [],
  }
}

async function handleAgent(request, env) {
  const caller = await verifyCaller(request, env)
  if (!caller) return json({ error: 'Não autorizado.' }, 401)

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY não está configurada neste Worker.' }, 503)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Corpo inválido.' }, 400)
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) return json({ error: 'Envie a mensagem.' }, 400)
  if (text.length > 500) return json({ error: 'Texto longo demais.' }, 400)

  const context = recortarContexto(body?.context)
  const history = (Array.isArray(body?.history) ? body.history.slice(-12) : [])
    .filter((m) => m && typeof m.text === 'string')
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text.slice(0, 500) }))

  try {
    const parsed = await callClaude(
      env,
      buildAgentPrompt({ text, today: body.today, weekday: body.weekday, history, context })
    )
    return json(normalizeAgent(parsed, { refs: refsDoContexto(context) }))
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

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY não está configurada neste Worker.' }, 503)
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
    const parsed = await callClaude(
      env,
      buildBriefingPrompt({ kind, today: body.today, weekday: body.weekday, context: body.context })
    )
    return json(normalizeBriefing(parsed))
  } catch (err) {
    return erroDeIA(err)
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

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY não está configurada neste Worker.' }, 503)
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
    const parsed = await callClaude(env, buildAnalyzePrompt({ text, today: body.today, weekday: body.weekday }))
    return json(normalizeAnalysis(parsed))
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

    if (url.pathname === '/api/agent') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
      return handleAgent(request, env)
    }

    if (url.pathname === '/api/briefing') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
      return handleBriefing(request, env)
    }

    if (url.pathname === '/api/analyze-note') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
      return handleAnalyzeNote(request, env)
    }

    return env.ASSETS.fetch(request)
  },
}
