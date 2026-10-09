// Worker do Segundo Cérebro.
//
// Ele continua servindo o site estático como antes; as rotas próprias usam
// o Gemini para interpretar texto em português: POST /api/esclarecer (lê um
// item da Entrada e propõe o que ele é), POST /api/briefing (propõe uma ação
// para cada item que pede decisão na revisão semanal, sob pedido), POST
// /api/analyze-note (sugestões a partir de uma anotação) e POST
// /api/search-notes (responde uma pergunta usando as anotações existentes) e
// POST /api/projeto (o assistente de um projeto: planejar passos, definir o
// resultado, dividir uma ideia em ações, redigir documentos do projeto e
// responder perguntas sobre ele).
// A chave do Gemini fica como segredo do Cloudflare e nunca chega ao
// navegador — é justamente por isso que essa parte roda no servidor.

import { handleAuth } from './auth.js'
import { handleAvisos, AvisosDoUsuario } from './avisos.js'

// O Durable Object dos avisos precisa ser exportado pelo módulo principal.
export { AvisosDoUsuario }

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

// Quanto esperar entre uma tentativa e outra quando o Gemini responde 503.
// Sobrecarga do lado do Google costuma durar segundos; antes, o primeiro 503
// já virava o aviso vermelho na tela, e a pessoa tentava de novo na mão —
// exatamente o que a segunda tentativa automática faz, sem o susto.
const ESPERAS_SOBRECARGA_MS = [1000, 2500]
// Limite por minuto com espera curta: vale aguardar aqui dentro, uma vez.
const ESPERA_MAXIMA_POR_MINUTO_S = 8

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

// Lê o corpo de erro do Gemini e diz QUAL limite foi: sobrecarga do
// servidor (503), limite por minuto ou cota do dia (429). O Google manda
// isso em `error.details` (QuotaFailure com o quotaId, RetryInfo com a
// espera). Antes o corpo era jogado fora, e "sobrecarregada ou sem cota"
// misturava dois problemas com soluções opostas: um passa sozinho em
// segundos, o outro só no dia seguinte.
export function classificarErroGemini(status, corpo) {
  if (status === 503 || status === 500) return { motivo: 'sobrecarga', esperaS: null, cota: '' }
  if (status !== 429) return null
  let detalhes = []
  try {
    detalhes = JSON.parse(corpo)?.error?.details || []
  } catch {
    detalhes = []
  }
  const cota = detalhes
    .flatMap((d) => (Array.isArray(d?.violations) ? d.violations : []))
    .map((v) => v?.quotaId || '')
    .find(Boolean) || ''
  const atraso = detalhes.map((d) => d?.retryDelay).find((r) => typeof r === 'string') || ''
  const esperaS = /^\d+(\.\d+)?s$/.test(atraso) ? Math.ceil(parseFloat(atraso)) : null
  // Sem quotaId, uma espera longa indica cota diária; curta, por minuto.
  const diaria = /PerDay/i.test(cota) || (!cota && esperaS !== null && esperaS > 120)
  return { motivo: diaria ? 'dia' : 'minuto', esperaS, cota }
}

function mensagemDoLimite({ motivo, esperaS }) {
  if (motivo === 'sobrecarga') {
    return 'Os servidores do Gemini estão sobrecarregados (tentei 3 vezes). Costuma passar em poucos minutos.'
  }
  if (motivo === 'dia') {
    return 'A cota diária gratuita do Gemini acabou. Ela renova à meia-noite do horário do Pacífico (4h ou 5h em Brasília).'
  }
  return `Muitos pedidos à IA no mesmo minuto. Tente de novo em ${esperaS ? `uns ${esperaS} segundos` : 'um minuto'}.`
}

async function callGemini(env, prompt, { esperar = dormir } = {}) {
  const model = env.GEMINI_MODEL || DEFAULT_MODEL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`
  const pedido = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  }

  let res
  let limite = null
  let esperouPorMinuto = false
  for (let tentativa = 0; ; tentativa++) {
    res = await fetch(url, pedido)
    if (res.ok) break
    const detalhe = await res.text()
    limite = classificarErroGemini(res.status, detalhe)
    // Fica nos logs do Worker (Cloudflare > Workers > Logs): é por aqui que
    // se descobre, depois, qual limite está batendo e com que frequência.
    console.warn('gemini', res.status, model, limite?.motivo || '', limite?.cota || '', detalhe.slice(0, 200))
    if (!limite) throw new Error(`Gemini respondeu ${res.status}: ${detalhe.slice(0, 300)}`)
    if (limite.motivo === 'sobrecarga' && tentativa < ESPERAS_SOBRECARGA_MS.length) {
      await esperar(ESPERAS_SOBRECARGA_MS[tentativa])
      continue
    }
    if (limite.motivo === 'minuto' && !esperouPorMinuto && limite.esperaS !== null && limite.esperaS <= ESPERA_MAXIMA_POR_MINUTO_S) {
      esperouPorMinuto = true
      await esperar(limite.esperaS * 1000)
      continue
    }
    const err = new Error(mensagemDoLimite(limite))
    err.transiente = true
    err.motivo = limite.motivo
    err.esperaS = limite.esperaS
    throw err
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
export { callGemini as _callGeminiParaTeste }

// A resposta de erro das rotas de IA. `transiente` é o que permite ao app
// distinguir "tenta de novo daqui a pouco que passa" de "isso não vai se
// resolver sozinho" — sem essa marca, os dois viram o mesmo aviso vermelho.
// `motivo` diz qual limite foi, e a mensagem já vem escrita para a tela.
function erroDeIA(err) {
  return json(
    { error: err.message, transiente: err.transiente === true, motivo: err.motivo || '', esperaS: err.esperaS ?? null },
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

// Uma palavra só, sem acento nem espaço: é assim que o contexto é gravado
// na etiqueta da nota (ver etiqueta() em gtd.js).
function normalizarContexto(valor) {
  const bruto = typeof valor === 'string' ? valor.trim() : ''
  return (
    bruto
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || null
  )
}

// Nada aqui é confiável por vir de um modelo — cada campo é validado antes de
// virar botão na tela, do mesmo jeito que as outras rotas fazem.
export function normalizeEsclarecer(parsed) {
  const tipo = TIPOS_ESCLARECER.has(parsed?.tipo) ? parsed.tipo : null
  const titulo = typeof parsed?.titulo === 'string' ? parsed.titulo.trim().slice(0, 300) : ''
  const contexto = normalizarContexto(parsed?.contexto)

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

// A revisão começou só comentando contagens ("3 atrasadas, 1 projeto
// parado") — e comentário sobre contagem não muda nada na semana de
// ninguém. Agora a IA recebe os itens que pedem decisão (quais tarefas
// atrasaram, quem está demorando, que projeto parou) e propõe UMA ação
// concreta para cada um, que vira botão na tela. Contar continua sendo
// trabalho do app (revisao.js), nunca da IA.
function buildRevisaoPrompt({ today, weekday, numeros, itens, candidatas, vagas }) {
  return `Você está ajudando na revisão semanal (método GTD) de alguém que trabalha com atendimento social/administrativo, em português do Brasil.

Hoje é ${weekday}, ${today}. Fuso: America/Sao_Paulo.

Números da semana, já calculados sem você:
${JSON.stringify(numeros ?? {})}

Itens que pedem uma decisão (use o "id" exatamente como está):
${JSON.stringify(itens ?? [])}

Próximas ações candidatas a ganhar um horário na agenda (use o "id" exatamente como está):
${JSON.stringify(candidatas ?? [])}

Vãos livres na agenda dos próximos dias — cada um é um intervalo [inicio, fim) de um "dia" (use exatamente esses valores):
${JSON.stringify(vagas ?? [])}

Para cada item em que houver uma sugestão clara, proponha UMA ação:
- tipo "atrasada": "remarcar" (com "data" AAAA-MM-DD, depois de hoje e realista para o que é), "algum_dia" (se parece que não vai sair tão cedo e não tem consequência real atrasar) ou "concluir" (só se o título indicar que provavelmente já foi feito; na dúvida, não).
- tipo "aguardando": "cobrar", com "titulo" da ação de cobrança — curto, começando por verbo e citando a pessoa (ex.: "Ligar para Ana sobre o laudo") — e "contexto" de uma palavra (ex.: "ligar", "email").
- tipo "projeto": "proxima_acao", com "titulo" de uma ação física e concreta que destrave o projeto (olhe as "relacionadas") e "contexto" de uma palavra.
- tipo "parada": o título é vago demais para ser uma ação de verdade (ex.: "Ver situação do Pedro") — "reescrever", com "titulo" reescrito como uma ação física e concreta, sem inventar fato novo (ex.: "Ligar para a escola do Pedro pedindo o boletim"); ou "algum_dia" se não for prioridade agora.
- tipo "algum_dia": "reativar" (com "titulo" reescrito, se ajudar clarear, ou null para manter o título) para trazer de volta a Próximas ações, ou "excluir" se o item já perdeu o sentido.

Além disso, monte um plano para a semana: escolha até 5 das "candidatas" e encaixe cada uma num dos "vagas", respeitando a duração dela ("duracao" em minutos; sem duração, considere 30min) sem passar do fim do vão. Não repita a mesma candidata nem sobreponha dois horários.

Responda SOMENTE com JSON, sem comentários, neste formato:
{
  "text": "comentário de até 40 palavras sobre a semana",
  "sugestoes": [ { "itemId": "id do item", "acao": "remarcar|algum_dia|concluir|cobrar|proxima_acao|reescrever|reativar|excluir", "motivo": "por que, em até 15 palavras", "data": "AAAA-MM-DD ou null", "titulo": "texto ou null", "contexto": "palavra ou null" } ],
  "plano": [ { "tarefaId": "id da candidata", "dia": "AAAA-MM-DD", "hora": "HH:MM", "motivo": "por que essa hora, em até 15 palavras" } ]
}

Regras:
- Tom direto e acolhedor, não robótico. O comentário não repete os números — a tela já mostra.
- Só use ids que estejam nas listas de itens/candidatas/vagas. Não invente item, candidata, vão, pessoa, data nem projeto.
- Se não houver sugestão boa para um item, deixe-o de fora — melhor menos sugestões certas que muitas vagas.
- Se nenhum vão couber uma candidata, deixe o plano menor — nunca proponha um horário fora dos vãos.
- Se as listas de itens e candidatas estiverem vazias, "sugestoes" e "plano" são [] e o comentário reconhece que a semana está em dia.`
}

// Quais ações fazem sentido para cada tipo de item. É a trava principal: o
// modelo pode propor "concluir" para uma espera ou "remarcar" um projeto, e
// isso não pode virar botão.
const ACOES_POR_TIPO = {
  atrasada: new Set(['remarcar', 'algum_dia', 'concluir']),
  aguardando: new Set(['cobrar']),
  projeto: new Set(['proxima_acao']),
  parada: new Set(['reescrever', 'algum_dia']),
  algum_dia: new Set(['reativar', 'excluir']),
}
const MAX_SUGESTOES = 8
const MAX_PLANO = 5
const MAX_CANDIDATAS = 10
const MAX_VAGAS = 40
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/
const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function hhmmParaMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function textoCurto(valor, limite) {
  return typeof valor === 'string' ? valor.trim().slice(0, limite) : ''
}

// Os itens vêm do próprio navegador, mas ainda são entrada externa: só o
// formato que o prompt espera passa, com teto de quantidade e de tamanho.
export function sanitizarItensDaRevisao(itens) {
  return (Array.isArray(itens) ? itens : [])
    .filter((i) => i && typeof i.id === 'string' && ACOES_POR_TIPO[i.tipo])
    .slice(0, 15)
    .map((i) => ({
      id: i.id.slice(0, 200),
      tipo: i.tipo,
      titulo: textoCurto(i.titulo, 200),
      ...(Number.isFinite(i.dias) ? { dias: i.dias } : {}),
      ...(i.quem ? { quem: textoCurto(i.quem, 80) } : {}),
      ...(Array.isArray(i.relacionadas)
        ? { relacionadas: i.relacionadas.slice(0, 3).map((r) => textoCurto(r, 200)) }
        : {}),
    }))
}

// Nada aqui é confiável por vir de um modelo: cada sugestão precisa apontar
// para um item que existe, com uma ação permitida para o tipo dele, e com o
// campo que essa ação exige — senão ela some em vez de virar um botão que
// faz a coisa errada.
export function normalizeRevisao(parsed, itens) {
  const porId = new Map(sanitizarItensDaRevisao(itens).map((i) => [i.id, i]))
  const vistos = new Set()
  const sugestoes = []

  for (const s of Array.isArray(parsed?.sugestoes) ? parsed.sugestoes : []) {
    const item = porId.get(s?.itemId)
    if (!item || vistos.has(item.id) || !ACOES_POR_TIPO[item.tipo].has(s?.acao)) continue

    const sugestao = { itemId: item.id, acao: s.acao, motivo: textoCurto(s.motivo, 200) }
    if (s.acao === 'remarcar') {
      if (!DATA_ISO.test(s.data || '')) continue
      sugestao.data = s.data
    }
    if (s.acao === 'cobrar' || s.acao === 'proxima_acao' || s.acao === 'reescrever') {
      const titulo = textoCurto(s.titulo, 200)
      if (!titulo) continue
      sugestao.titulo = titulo
      // Só cobrar/próxima ação viram uma tarefa nova, que precisa de
      // contexto; reescrever só troca o título da tarefa que já existe.
      if (s.acao !== 'reescrever') sugestao.contexto = normalizarContexto(s.contexto)
    }
    if (s.acao === 'reativar') {
      // Reativar não exige reescrever o título — null mantém o que já tinha.
      const titulo = textoCurto(s.titulo, 200)
      if (titulo) sugestao.titulo = titulo
    }
    // 'concluir', 'algum_dia' (a ação, não o tipo) e 'excluir' não têm
    // campo extra: a tarefa em si já diz tudo que a ação precisa saber.

    vistos.add(item.id)
    sugestoes.push(sugestao)
    if (sugestoes.length >= MAX_SUGESTOES) break
  }

  return { text: textoCurto(parsed?.text, 400), sugestoes }
}

// Os mesmos cuidados de sanitizarItensDaRevisao, para as duas listas novas
// do plano da semana: candidatas a próxima ação e vãos livres da agenda.
export function sanitizarCandidatas(candidatas) {
  return (Array.isArray(candidatas) ? candidatas : [])
    .filter((c) => c && typeof c.id === 'string')
    .slice(0, MAX_CANDIDATAS)
    .map((c) => ({
      id: c.id.slice(0, 200),
      titulo: textoCurto(c.titulo, 200),
      ...(typeof c.prioridade === 'string' ? { prioridade: textoCurto(c.prioridade, 20) } : {}),
      ...(DATA_ISO.test(c.prazo || '') ? { prazo: c.prazo } : {}),
      ...(Number.isFinite(c.duracao) ? { duracao: c.duracao } : {}),
    }))
}

export function sanitizarVagas(vagas) {
  return (Array.isArray(vagas) ? vagas : [])
    .filter((v) => v && DATA_ISO.test(v.dia || '') && HORA_HHMM.test(v.inicio || '') && HORA_HHMM.test(v.fim || ''))
    .filter((v) => hhmmParaMinutos(v.fim) > hhmmParaMinutos(v.inicio))
    .slice(0, MAX_VAGAS)
    .map((v) => ({ dia: v.dia, inicio: v.inicio, fim: v.fim }))
}

// O plano é diferente das sugestões: não é "uma ação por item conhecido", é
// "encaixa esta candidata neste vão" — por isso a validação central aqui é
// geométrica, não de vocabulário: o horário proposto precisa caber dentro de
// algum vão de verdade daquele dia, com a duração da candidata (ou 30min sem
// estimativa) inteira dentro dele.
export function normalizePlano(planoBruto, candidatasBrutas, vagasBrutas) {
  const candidatas = new Map(sanitizarCandidatas(candidatasBrutas).map((c) => [c.id, c]))
  const vagasPorDia = new Map()
  for (const v of sanitizarVagas(vagasBrutas)) {
    if (!vagasPorDia.has(v.dia)) vagasPorDia.set(v.dia, [])
    vagasPorDia.get(v.dia).push(v)
  }

  const usadas = new Set()
  const plano = []
  for (const p of Array.isArray(planoBruto) ? planoBruto : []) {
    const candidata = candidatas.get(p?.tarefaId)
    if (!candidata || usadas.has(candidata.id)) continue
    if (!DATA_ISO.test(p?.dia || '') || !HORA_HHMM.test(p?.hora || '')) continue

    const duracao = candidata.duracao || 30
    const inicioMin = hhmmParaMinutos(p.hora)
    const cabeEmAlgumVao = (vagasPorDia.get(p.dia) || []).some(
      (v) => inicioMin >= hhmmParaMinutos(v.inicio) && inicioMin + duracao <= hhmmParaMinutos(v.fim)
    )
    if (!cabeEmAlgumVao) continue

    usadas.add(candidata.id)
    plano.push({ tarefaId: candidata.id, dia: p.dia, hora: p.hora, motivo: textoCurto(p.motivo, 200) })
    if (plano.length >= MAX_PLANO) break
  }
  return plano
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

  try {
    const itens = sanitizarItensDaRevisao(body.itens)
    const candidatas = sanitizarCandidatas(body.candidatas)
    const vagas = sanitizarVagas(body.vagas)
    const parsed = await callGemini(
      env,
      buildRevisaoPrompt({ today: body.today, weekday: body.weekday, numeros: body.numeros, itens, candidatas, vagas })
    )
    const { text, sugestoes } = normalizeRevisao(parsed, itens)
    const plano = normalizePlano(parsed?.plano, candidatas, vagas)
    return json({ text, sugestoes, plano })
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

// ---------- Projeto ----------
//
// Uma rota para o assistente de um projeto, com um modo por botão. Tudo o
// que chega do navegador é limpo antes de ir para o prompt (tamanho e tipo
// de cada campo), e tudo o que volta do modelo é validado antes de virar
// tarefa ou ficha — o mesmo cuidado de normalizeRevisao.

const LISTAS_DO_PROJETO = ['proximas', 'aguardando', 'algum_dia', 'entrada', 'outras', 'concluida']
const MAX_TAREFAS_PROJETO = 40
const MAX_ANOTACOES_PROJETO = 12
const MAX_ACOES_PLANO = 7

function texto(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function slugDeContexto(v) {
  if (typeof v !== 'string') return null
  const limpo = v
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
  return limpo || null
}

export function sanitizarContextoDoProjeto(body) {
  const projeto = body?.projeto || {}
  const tarefas = (Array.isArray(body?.tarefas) ? body.tarefas : [])
    .map((t) => ({
      titulo: texto(t?.titulo, 200),
      lista: LISTAS_DO_PROJETO.includes(t?.lista) ? t.lista : 'outras',
      prazo: DATA_ISO.test(t?.prazo || '') ? t.prazo : null,
    }))
    .filter((t) => t.titulo)
    .slice(0, MAX_TAREFAS_PROJETO)
  const anotacoes = (Array.isArray(body?.anotacoes) ? body.anotacoes : [])
    .map((n) => ({ titulo: texto(n?.titulo, 120), trecho: texto(n?.trecho, 1200) }))
    .filter((n) => n.titulo || n.trecho)
    .slice(0, MAX_ANOTACOES_PROJETO)
  const contextos = (Array.isArray(body?.contextos) ? body.contextos : []).map(slugDeContexto).filter(Boolean).slice(0, 20)
  const alvo = body?.alvo && texto(body.alvo.titulo, 600) ? { titulo: texto(body.alvo.titulo, 600), notas: texto(body.alvo.notas, 1500) } : null
  const documento = body?.documento && DOCUMENTOS_DO_PROJETO[body.documento.tipo]
    ? { tipo: body.documento.tipo, instrucao: texto(body.documento.instrucao, 3000) }
    : null
  return {
    projeto: {
      nome: texto(projeto.nome, 120) || 'Projeto',
      tipo: projeto.tipo === 'rotina' ? 'rotina' : 'projeto',
      resultado: texto(projeto.resultado, 500),
      prazo: DATA_ISO.test(projeto.prazo || '') ? projeto.prazo : null,
    },
    tarefas,
    anotacoes,
    contextos,
    alvo,
    documento,
    pergunta: texto(body?.pergunta, 300),
  }
}

function blocoDoProjeto(ctx) {
  const tarefas = ctx.tarefas.length
    ? ctx.tarefas.map((t) => `- [${t.lista}] ${t.titulo}${t.prazo ? ` (prazo ${t.prazo})` : ''}`).join('\n')
    : '(nenhuma tarefa ainda)'
  const anotacoes = ctx.anotacoes.length
    ? ctx.anotacoes.map((n) => `### ${n.titulo || '(sem título)'}\n${n.trecho}`).join('\n\n')
    : '(nenhuma anotação)'
  return `PROJETO: ${ctx.projeto.nome} (${ctx.projeto.tipo === 'rotina' ? 'rotina contínua, como uma reunião periódica' : 'projeto com começo, meio e fim'})
${ctx.projeto.resultado ? `Resultado esperado / propósito: ${ctx.projeto.resultado}` : 'Resultado esperado: (ainda não definido)'}
${ctx.projeto.prazo ? `Prazo do projeto: ${ctx.projeto.prazo}` : ''}

TAREFAS (a lista entre colchetes diz onde cada uma está no método GTD):
${tarefas}

ANOTAÇÕES DO PROJETO (trechos):
${anotacoes}`
}

function buildProjetoPrompt(modo, ctx, { today, weekday }) {
  const cabeca = `Você ajuda alguém que trabalha com atendimento social e gestão pública a tocar seus projetos pelo método GTD (David Allen), em português do Brasil.
Hoje é ${weekday || ''}, ${today || ''}. Fuso: America/Sao_Paulo.

${blocoDoProjeto(ctx)}
`
  if (modo === 'planejar') {
    return `${cabeca}
Proponha as próximas ações concretas que fazem este projeto andar em direção ao resultado.

Responda SOMENTE com JSON:
{
  "acoes": [
    { "titulo": "verbo no infinitivo + objeto, ação física e visível, até 90 caracteres", "contexto": "um destes: ${ctx.contextos.join(', ') || 'computador, telefone, rua'} (ou vazio)", "prioridade": "alta|media|baixa", "prazo": "AAAA-MM-DD ou null", "motivo": "por que esta ação, em até 20 palavras" }
  ]
}

Regras:
- De 3 a ${MAX_ACOES_PLANO} ações, na ordem em que fazem sentido.
- Cada ação é UM passo físico ("Ligar para X para confirmar Y", "Rascunhar o ofício de Z"), nunca um objetivo vago ("Melhorar", "Pensar sobre").
- Não repita tarefas que já existem na lista acima.
- Prazo só quando houver motivo claro (prazo do projeto, compromisso citado); senão null. Nunca uma data passada.
- Use apenas o que está no projeto; não invente nomes de pessoas, órgãos ou fatos.`
  }
  if (modo === 'resultado') {
    return `${cabeca}
${ctx.projeto.tipo === 'rotina'
    ? 'Escreva o propósito desta rotina: para que ela serve, em uma frase.'
    : 'Escreva o resultado esperado deste projeto: como se sabe que ele terminou, em uma frase concreta e verificável (ex.: "Protocolo publicado e equipe treinada").'}

Responda SOMENTE com JSON: { "resultado": "até 200 caracteres" }
Regras: só com base no que está acima; nada de metas genéricas.`
  }
  if (modo === 'dividir') {
    return `${cabeca}
A tarefa abaixo foi escrita como uma ideia inteira, não como uma ação. Separe:
- "acao": o primeiro passo físico e concreto (verbo no infinitivo + objeto, até 90 caracteres);
- "detalhes": o restante do texto original, reorganizado como notas de apoio (sem perder informação);
- "mais": os passos seguintes que o texto deixa claros (no máximo 5), cada um como ação curta.

TAREFA:
"""
${ctx.alvo?.titulo || ''}
${ctx.alvo?.notas || ''}
"""

Responda SOMENTE com JSON: { "acao": "...", "detalhes": "...", "mais": ["...", "..."] }`
  }
  if (modo === 'documento') {
    const doc = DOCUMENTOS_DO_PROJETO[ctx.documento.tipo]
    return `${cabeca}
Redija ${doc.pedido}
${ctx.documento.instrucao ? `\nORIENTAÇÕES E MATERIAL DE QUEM PEDIU (prevalecem sobre o resto):\n"""\n${ctx.documento.instrucao}\n"""\n` : ''}
Responda SOMENTE com JSON: { "titulo": "título curto do documento, até 80 caracteres", "texto": "o documento completo, em texto simples com quebras de linha" }

Regras:
- Use apenas fatos que estão no projeto ou nas orientações; onde faltar um dado (nome, número, data), deixe um marcador entre colchetes, como [nome do destinatário]. Nunca invente.
- Português formal e claro, sem markdown (nada de # ou **); listas com hífen.
- ${doc.regra}`
  }
  if (modo === 'perguntar') {
    return `${cabeca}
Responda à pergunta abaixo usando SOMENTE o que está no projeto (ficha, tarefas e anotações). Se a resposta não estiver ali, diga isso com clareza em vez de supor.

PERGUNTA: ${ctx.pergunta}

Responda SOMENTE com JSON: { "resposta": "até 120 palavras", "fontes": [números das anotações usadas, contando a partir de 1 na ordem acima] }`
  }
  return null
}

// O que cada documento pede ao modelo. Ficam aqui (e não no navegador) para
// que o prompt não possa ser trocado por quem chama a rota.
const DOCUMENTOS_DO_PROJETO = {
  ata: { pedido: 'a ata da reunião deste projeto/rotina.', regra: 'Estrutura: data e participantes (com marcadores se não informados), pauta, o que foi discutido, encaminhamentos com responsável e prazo.' },
  pauta: { pedido: 'a pauta da próxima reunião.', regra: 'Itens numerados, começando pelo que está pendente ou atrasado; no fim, "Encaminhamentos da reunião anterior" se houver.' },
  relatorio: { pedido: 'um relatório de andamento do projeto.', regra: 'Seções: Situação geral, O que foi feito, Pendências e riscos, Próximos passos.' },
  plano: { pedido: 'um plano de ação para chegar ao resultado do projeto.', regra: 'Tabela em texto: ação — responsável — prazo — situação, uma por linha, na ordem de execução.' },
  oficio: { pedido: 'um ofício formal relacionado a este projeto.', regra: 'Formato de ofício da administração pública: número [nº], local e data, destinatário, assunto, corpo objetivo, fecho "Atenciosamente" e assinatura com marcadores.' },
  email: { pedido: 'um e-mail cordial de cobrança ou acompanhamento sobre o que está pendente (especialmente o que está em "aguardando").', regra: 'Curto: saudação, o que se espera e desde quando, pedido claro de retorno com data, despedida. Comece o texto pela linha "Assunto: ...".' },
}
export const TIPOS_DE_DOCUMENTO = Object.keys(DOCUMENTOS_DO_PROJETO)

export function normalizeDocumento(parsed) {
  return { titulo: texto(parsed?.titulo, 120), texto: texto(parsed?.texto, 8000) }
}

// As fontes voltam como números; aqui viram os títulos das anotações reais,
// descartando o que não existe — a resposta nunca cita uma nota inventada.
export function normalizePergunta(parsed, anotacoes = []) {
  const fontes = [...new Set((Array.isArray(parsed?.fontes) ? parsed.fontes : []).map(Number))]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= anotacoes.length)
    .map((n) => anotacoes[n - 1].titulo || '(sem título)')
  return { resposta: texto(parsed?.resposta, 1500), fontes }
}

export function normalizePlanejar(parsed, { contextos = [], existentes = [], hoje = '' } = {}) {
  const ja = new Set(existentes.map((t) => t.toLowerCase().trim()))
  const vistos = new Set()
  const acoes = []
  for (const a of Array.isArray(parsed?.acoes) ? parsed.acoes : []) {
    const titulo = texto(a?.titulo, 120)
    const chave = titulo.toLowerCase()
    if (!titulo || ja.has(chave) || vistos.has(chave)) continue
    vistos.add(chave)
    const contexto = slugDeContexto(a?.contexto)
    acoes.push({
      titulo,
      contexto: contexto && (contextos.length === 0 || contextos.includes(contexto) || contexto.length <= 20) ? contexto : null,
      prioridade: ['alta', 'media', 'baixa'].includes(a?.prioridade) ? a.prioridade : 'media',
      prazo: DATA_ISO.test(a?.prazo || '') && (!hoje || a.prazo >= hoje) ? a.prazo : null,
      motivo: texto(a?.motivo, 200),
    })
    if (acoes.length >= MAX_ACOES_PLANO) break
  }
  return { acoes }
}

export function normalizeResultado(parsed) {
  return { resultado: texto(parsed?.resultado, 300) }
}

export function normalizeDividir(parsed) {
  const mais = (Array.isArray(parsed?.mais) ? parsed.mais : []).map((m) => texto(m, 120)).filter(Boolean).slice(0, 5)
  return { acao: texto(parsed?.acao, 120), detalhes: texto(parsed?.detalhes, 2000), mais }
}

const MODOS_DO_PROJETO = ['planejar', 'resultado', 'dividir', 'documento', 'perguntar']

async function handleProjeto(request, env) {
  const caller = await verifyCaller(request, env)
  if (!caller) return json({ error: 'Não autorizado.' }, 401)
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY não está configurada neste Worker.' }, 503)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Corpo inválido.' }, 400)
  }

  const modo = body?.modo
  if (!MODOS_DO_PROJETO.includes(modo)) return json({ error: 'Modo desconhecido.' }, 400)
  const ctx = sanitizarContextoDoProjeto(body)
  if (modo === 'dividir' && !ctx.alvo) return json({ error: 'Envie a tarefa a dividir.' }, 400)
  if (modo === 'documento' && !ctx.documento) return json({ error: 'Tipo de documento desconhecido.' }, 400)
  if (modo === 'perguntar' && !ctx.pergunta) return json({ error: 'Envie a pergunta.' }, 400)

  try {
    const parsed = await callGemini(env, buildProjetoPrompt(modo, ctx, { today: body.today, weekday: body.weekday }))
    if (modo === 'planejar') {
      return json(normalizePlanejar(parsed, { contextos: ctx.contextos, existentes: ctx.tarefas.map((t) => t.titulo), hoje: body.hojeIso }))
    }
    if (modo === 'resultado') return json(normalizeResultado(parsed))
    if (modo === 'documento') return json(normalizeDocumento(parsed))
    if (modo === 'perguntar') return json(normalizePergunta(parsed, ctx.anotacoes))
    return json(normalizeDividir(parsed))
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

    if (url.pathname === '/api/projeto') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
      return handleProjeto(request, env)
    }

    if (url.pathname === '/api/avisos' || url.pathname === '/api/avisos/chave') {
      const caller = await verifyCaller(request, env)
      if (!caller) return json({ error: 'Não autorizado.' }, 401)
      return handleAvisos(request, env, caller, json)
    }

    if (url.pathname === '/api/search-notes') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
      return handleSearchNotes(request, env)
    }

    return env.ASSETS.fetch(request)
  },
}
