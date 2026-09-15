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

// "reunião 14h por 40min", "visita 9h 1h30", "audiência às 15h durante 2 horas"
const DURATION_PATTERNS = [
  { re: /\b(?:por|durante|de)\s+(\d{1,2})\s*h(?:oras?)?\s*(\d{1,2})?\s*(?:min|minutos?)?\b/i, kind: 'hm' },
  { re: /\b(?:por|durante|de)\s+(\d{1,3})\s*(?:min|minutos?)\b/i, kind: 'm' },
  { re: /\b(\d{1,2})h(\d{2})\s*(?:de\s+duração)\b/i, kind: 'hm' },
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
  return cleaned.replace(/\s{2,}/g, ' ').replace(/^[,\s-]+|[,\s-]+$/g, '').trim()
}

// O chrono.pt não reconhece "13h15", "14h" nem "8h" — só o formato com
// dois-pontos, e mesmo assim precisa do "às" para grudar a hora na data.
// Como essa é a forma normal de escrever hora em português, o texto é
// normalizado antes de ir para o parser.
const BR_TIME = /\b(\d{1,2})\s*h(?:oras?)?\s*(\d{2})?\b/gi

function normalizeTimes(text) {
  const withColons = text.replace(BR_TIME, (match, hours, minutes) => {
    const h = Number(hours)
    if (h > 23) return match
    return `às ${String(h).padStart(2, '0')}:${minutes || '00'}`
  })
  return withColons.replace(/\b(?:às|as)\s+(?:às|as)\b/gi, 'às')
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

  const result = results[0]
  const start = result.start.date()
  const hasTime = result.start.isCertain('hour')
  const title = cleanTitle(text, result.text)

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
