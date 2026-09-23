import * as chrono from 'chrono-node'
import { etiqueta } from './gtd.js'
import { detectarRecorrencia } from './recorrencia.js'

// As mesmas frases de detectarRecorrencia (recorrencia.js), só que aqui é
// para tirar o ruído do título, não para decidir se repete.
//
// "toda segunda" mantém o nome do dia no texto — é ele que o chrono usa para
// achar a data certa do primeiro compromisso da série; só o "toda"/"todo" na
// frente sobra depois que o chrono processa. Já "todos os dias",
// "semanalmente", "mensalmente" e "todo mês"/"todo ano" não têm dia nenhum
// para o chrono reconhecer, então o trecho inteiro é ruído.
const DIAS_SEMANA_RE = 'segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo'
const RECORRENCIA_PREFIXO_DIA = new RegExp(`\\btod[ao]\\s+(?=(${DIAS_SEMANA_RE})(-feira)?\\b)`, 'giu')
const RECORRENCIA_RUIDO = /\b(diariamente|semanalmente|mensalmente|anualmente|todos?\s+os?\s+dias?|todo\s+m[êe]s|todo\s+ano)\b/giu

// "hoje" saiu daqui: aparece em quase todo compromisso marcado para o mesmo
// dia ("Reunião hoje às 15h com o fornecedor"), e isso inflava qualquer coisa
// para "alta" sem nenhuma urgência real por trás — só o dia batendo com hoje.
const URGENT_WORDS = ['urgente', 'agora', 'imediato']
const IMPORTANT_WORDS = ['importante', 'prazo', 'até', 'entregar']

// As mesmas palavras de prioridade, só que o que sai do título quando vira
// dado estruturado. "prazo" e "entregar" ficam de fora de propósito: são o
// verbo e o substantivo que dizem o que fazer ("Entregar relatório", "Prazo
// do projeto") — tirar como se fossem só marcador apagava o sentido inteiro
// do título ("Entregar relatório até sexta-feira" virava só "relatório").
const TITLE_NOISE_WORDS = ['urgente', 'hoje', 'agora', 'imediato', 'importante', 'até']

const DEFAULT_MINUTES = 60

// Devolve null quando nada no texto indica urgência. Antes isso virava
// "pode esperar", o que fazia o app afirmar uma prioridade que o usuário nunca
// escreveu; agora quem decide o padrão é o formulário.
function detectPriority(text) {
  const lower = text.toLowerCase()
  if (URGENT_WORDS.some((w) => lower.includes(w))) return 'alta'
  if (IMPORTANT_WORDS.some((w) => lower.includes(w))) return 'media'
  return null
}

// @contexto e #projeto escritos direto na captura ("ligar pro banco @carro")
// são o mesmo sinal explícito que a Entrada já pede na mão — por isso contam
// como "isto já é uma tarefa decidida", em vez de precisar passar pela
// triagem. A normalização é a mesma etiqueta.js do resto do app (gtd.js),
// para "@Carro" e "@carro" caírem no mesmo contexto de sempre.
const TAG_CONTEXTO = /(?<!\S)@([^\s@#]+)/
const TAG_PROJETO = /(?<!\S)#([^\s@#]+)/
const TAGS_GLOBAL = /(?<!\S)[@#][^\s@#]+/g

function extrairTags(text) {
  const contextoMatch = text.match(TAG_CONTEXTO)
  const projetoMatch = text.match(TAG_PROJETO)
  return {
    contexto: contextoMatch ? etiqueta(contextoMatch[1]) || null : null,
    projeto: projetoMatch ? etiqueta(projetoMatch[1]) || null : null,
    semTags: text.replace(TAGS_GLOBAL, ' '),
  }
}

// "por 40min", "durante 2 horas", "umas 2 horas", "por 2hs"
const DURATION_PREFIX = '(?:por|durante|umas?|cerca de|aprox(?:imadamente)?)'

// "h(?:oras?|s)?" cobre "h", "hora(s)" e o "hs" abreviado ("por 2hs"); sem o
// "s" essa forma não batia com nada aqui e sobrava pro reconhecedor de
// horário, que lia "2hs" como "às 02:00" em vez de duração.
const DURATION_PATTERNS = [
  { re: new RegExp(`\\b${DURATION_PREFIX}\\s+(\\d{1,2})\\s*h(?:oras?|s)?\\s*(\\d{1,2})?\\s*(?:min|minutos?)?\\b`, 'i'), kind: 'hm' },
  // "de 1h30" é duração, mas só com os minutos escritos — "de 9h" sozinho é
  // como a maioria escreve horário ("reunião de 9h" = "às 9h"), não duração.
  // Sem essa exigência, "Reunião de 9h amanhã" perdia a hora inteira para a
  // duração e o compromisso virava tarefa sem horário nenhum.
  { re: /\bde\s+(\d{1,2})h(\d{2})\b/i, kind: 'hm' },
  { re: new RegExp(`\\b${DURATION_PREFIX}\\s+(\\d{1,3})\\s*(?:min|minutos?)\\b`, 'i'), kind: 'm' },
  { re: /\b(\d{1,2})h(\d{2})?\s*(?:de\s+duração)\b/i, kind: 'hm' },
]

function detectDuration(text) {
  for (const { re, kind } of DURATION_PATTERNS) {
    const match = text.match(re)
    if (!match) continue
    const minutes =
      kind === 'm' ? Number(match[1]) : Number(match[1]) * 60 + Number(match[2] || 0)
    if (minutes > 0 && minutes <= 12 * 60) return { minutes, text: match[0] }
  }
  return null
}

// Tira do título só os trechos que viraram dado estruturado (a data/hora e a
// duração) e as palavras de prioridade. Palavras comuns como "de" e "às" ficam:
// removê-las quebrava títulos como "Reunião de equipe".
function cleanTitle(text, ...segmentsToRemove) {
  let cleaned = text
  for (const segment of segmentsToRemove) {
    if (segment) cleaned = cleaned.replace(segment, ' ')
  }
  // \b não fecha palavra terminada em acento ("até"), porque só considera
  // [A-Za-z0-9_]; por isso a borda é feita com lookaround sobre letras.
  cleaned = cleaned.replace(new RegExp(`(?<!\\p{L})(${TITLE_NOISE_WORDS.join('|')})(?!\\p{L})`, 'giu'), ' ')
  // "quinta que vem": o dia já virou data, e o "que vem" sozinho não é título.
  cleaned = cleaned.replace(/(?<!\p{L})que\s+vem(?!\p{L})/giu, ' ')
  return cleaned.replace(/\s{2,}/g, ' ').replace(/^[,\s-]+|[,\s-]+$/g, '').trim()
}

// O chrono.pt não reconhece "13h15", "14h" nem "8h" — só o formato com
// dois-pontos, e mesmo assim precisa do "às" para grudar a hora na data.
// Como essa é a forma normal de escrever hora em português, o texto é
// normalizado antes de ir para o parser.
// Só a forma compacta ("14h", "14h30", "8h05"), sem espaço antes do "h": assim
// "umas 2 horas" continua sendo duração em vez de virar 02:00. A forma por
// extenso só vira horário quando vem com "às".
// O "s" no fim é o "14hs"/"9hs" que praticamente todo mundo escreve no
// dia a dia; sem aceitar essa forma, esses compromissos caíam sempre como
// tarefa por não terem hora nenhuma reconhecida.
const BR_TIME_COMPACT = /\b(\d{1,2})h(\d{2})?s?\b/gi
// "às" começa com acento, e \b não abre palavra acentuada: a borda precisa ser
// por lookaround, senão "às 14 horas" nunca casa.
const BR_TIME_SPELLED = /(?<!\p{L})(?:às|as)\s+(\d{1,2})\s*horas?(?!\p{L})/giu
const DOUBLE_AS = /(?<!\p{L})(?:às|as)\s+(?=às\s)/giu

function toClock(hours, minutes) {
  return `às ${String(Number(hours)).padStart(2, '0')}:${minutes || '00'}`
}

function normalizeTimes(text) {
  const normalized = text
    .replace(BR_TIME_SPELLED, (match, hours) => (Number(hours) > 23 ? match : toClock(hours)))
    .replace(BR_TIME_COMPACT, (match, hours, minutes) =>
      Number(hours) > 23 ? match : toClock(hours, minutes)
    )
  return normalized.replace(DOUBLE_AS, '')
}

// O chrono não gruda a hora na data quando há palavras no meio ("quinta que
// vem 14h"): ele casa só o dia. Se sobrou um horário solto no texto, ele vale.
const LEFTOVER_CLOCK = /(?<!\p{L})às\s+([01]?\d|2[0-3]):([0-5]\d)(?!\p{L})/u

// "dia 20" é a forma mais comum de marcar data no Brasil, e o chrono.pt não
// reconhece: o trecho ficava no título e o compromisso ia parar noutro dia,
// em silêncio — que é o pior jeito de errar numa agenda. Vira uma data que o
// chrono lê, do mesmo jeito que normalizeTimes faz com "9h30".
const DAY_OF_MONTH = /(?<!\p{L})dia\s+(\d{1,2})(?![\d/\-.h:])/giu

function normalizeDayOfMonth(text, reference) {
  return text.replace(DAY_OF_MONTH, (match, rawDay) => {
    const day = Number(rawDay)
    if (day < 1 || day > 31) return match
    const month = reference.getMonth()
    // "dia 3" escrito no dia 28 é o mês que vem; e um dia que não cabe no mês
    // atual (31 em mês de 30) também empurra para o seguinte.
    const inThisMonth = new Date(reference.getFullYear(), month, day)
    const useNext = inThisMonth.getMonth() !== month || day < reference.getDate()
    const target = new Date(reference.getFullYear(), month + (useNext ? 1 : 0), day)
    // Data que não existe nem no mês seguinte: melhor deixar como o usuário
    // escreveu do que inventar um dia.
    if (target.getDate() !== day) return match
    const dd = String(day).padStart(2, '0')
    const mm = String(target.getMonth() + 1).padStart(2, '0')
    return ` ${dd}/${mm}/${target.getFullYear()} `
  })
}

function recoverTime(text, day) {
  const match = text.match(LEFTOVER_CLOCK)
  if (!match) return null
  const withTime = new Date(day)
  withTime.setHours(Number(match[1]), Number(match[2]), 0, 0)
  return { date: withTime, text: match[0] }
}

// Analisa um texto digitado em linguagem natural (pt-BR) e devolve
// uma estrutura pronta para virar evento (Calendar) ou tarefa (Tasks).
export function parseQuickAdd(rawText, referenceDate = new Date()) {
  const { contexto, projeto, semTags } = extrairTags(rawText)
  const recorrencia = detectarRecorrencia(semTags)
  const duration = detectDuration(semTags)
  // A duração sai do texto antes da data para "por 2 horas" não virar horário.
  const withoutDuration = duration ? semTags.replace(duration.text, ' ') : semTags
  // O "toda"/"todo" antes do dia da semana sai agora, para o chrono continuar
  // vendo "segunda às 14h" normalmente — sem essa etapa, "toda" ficaria como
  // ruído solto no título depois que o chrono consome só o dia e a hora.
  const text = normalizeDayOfMonth(normalizeTimes(withoutDuration), referenceDate).replace(
    RECORRENCIA_PREFIXO_DIA,
    ''
  )

  const results = chrono.pt.parse(text, referenceDate, { forwardDate: true })
  const priority = detectPriority(rawText)

  if (results.length === 0) {
    return {
      type: 'task',
      title: cleanTitle(text),
      priority,
      contexto,
      projeto,
      due: null,
      durationMinutes: duration?.minutes ?? DEFAULT_MINUTES,
    }
  }

  // Prefere o trecho que fixou o dia: "às 14:00 quarta" vira dois resultados,
  // e o primeiro (a hora) sozinho cairia no dia de hoje.
  const result = results.find((r) => r.start.isCertain('day')) || results[0]
  let start = result.start.date()
  let hasTime = result.start.isCertain('hour')
  let leftover = null

  if (!hasTime) {
    const recovered = recoverTime(text.replace(result.text, ' '), start)
    if (recovered) {
      start = recovered.date
      hasTime = true
      leftover = recovered.text
    }
  }

  const title = cleanTitle(text, result.text, leftover)

  if (hasTime) {
    const minutes = duration?.minutes ?? DEFAULT_MINUTES
    // chrono entende "das 14h às 15h30" sozinho; nesse caso o fim dele manda.
    const end = result.end?.date() || new Date(start.getTime() + minutes * 60000)
    return {
      type: 'event',
      // "diariamente"/"todo mês"/"todo ano"/"semanalmente" não carregam dia
      // nenhum que o chrono já tenha consumido — só saem daqui, no fim.
      title: (recorrencia ? title.replace(RECORRENCIA_RUIDO, ' ').replace(/\s{2,}/g, ' ').trim() : title) || 'Compromisso',
      priority,
      recorrencia,
      start,
      end,
      durationMinutes: Math.round((end - start) / 60000),
    }
  }

  // Tem data mas não hora específica -> tarefa com prazo
  return {
    type: 'task',
    title: title || 'Tarefa',
    priority,
    contexto,
    projeto,
    due: start,
    durationMinutes: duration?.minutes ?? DEFAULT_MINUTES,
  }
}

// Para onde a captura vai, sem perguntar: compromisso com dia e hora certos
// cai direto na agenda; tarefa com algum sinal explícito (prazo, prioridade,
// contexto ou projeto escritos no próprio texto) cai direto em Próximas
// ações; o resto — pensamento cru, sem nenhum desses sinais — precisa da
// Entrada, que é o único caso em que decidir o que aquilo é ainda vale o
// tempo de uma triagem separada.
export function decidirDestino(preview) {
  if (!preview) return 'entrada'
  if (preview.type === 'event') return 'evento'
  if (preview.type === 'task' && (preview.due || preview.priority || preview.contexto || preview.projeto)) {
    return 'tarefa'
  }
  return 'entrada'
}
