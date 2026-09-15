import * as chrono from 'chrono-node'

const URGENT_WORDS = ['urgente', 'hoje', 'agora', 'imediato']
const IMPORTANT_WORDS = ['importante', 'prazo', 'até', 'entregar']

const DEFAULT_MINUTES = 60

function detectPriority(text) {
  const lower = text.toLowerCase()
  if (URGENT_WORDS.some((w) => lower.includes(w))) return 'urgente'
  if (IMPORTANT_WORDS.some((w) => lower.includes(w))) return 'importante'
  return 'pode_esperar'
}

// "por 40min", "durante 2 horas", "umas 2 horas", "de 1h30"
const DURATION_PREFIX = '(?:por|durante|umas?|cerca de|aprox(?:imadamente)?|de)'

const DURATION_PATTERNS = [
  { re: new RegExp(`\\b${DURATION_PREFIX}\\s+(\\d{1,2})\\s*h(?:oras?)?\\s*(\\d{1,2})?\\s*(?:min|minutos?)?\\b`, 'i'), kind: 'hm' },
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
  const priorityWords = [...URGENT_WORDS, ...IMPORTANT_WORDS]
  cleaned = cleaned.replace(new RegExp(`(?<!\\p{L})(${priorityWords.join('|')})(?!\\p{L})`, 'giu'), ' ')
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
const BR_TIME_COMPACT = /\b(\d{1,2})h(\d{2})?\b/gi
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
  const duration = detectDuration(rawText)
  // A duração sai do texto antes da data para "por 2 horas" não virar horário.
  const withoutDuration = duration ? rawText.replace(duration.text, ' ') : rawText
  const text = normalizeTimes(withoutDuration)

  const results = chrono.pt.parse(text, referenceDate, { forwardDate: true })
  const priority = detectPriority(rawText)

  if (results.length === 0) {
    return {
      type: 'task',
      title: cleanTitle(text),
      priority,
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
      title: title || 'Compromisso',
      priority,
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
    due: start,
    durationMinutes: duration?.minutes ?? DEFAULT_MINUTES,
  }
}
