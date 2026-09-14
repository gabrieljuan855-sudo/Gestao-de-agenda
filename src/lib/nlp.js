import * as chrono from 'chrono-node'

const URGENT_WORDS = ['urgente', 'hoje', 'agora', 'imediato']
const IMPORTANT_WORDS = ['importante', 'prazo', 'até', 'entregar']

function detectPriority(text) {
  const lower = text.toLowerCase()
  if (URGENT_WORDS.some((w) => lower.includes(w))) return 'urgente'
  if (IMPORTANT_WORDS.some((w) => lower.includes(w))) return 'importante'
  return 'pode_esperar'
}

// Remove o trecho de data/hora e as palavras de prioridade do texto,
// deixando só o título limpo da tarefa/evento.
function cleanTitle(text, chronoText) {
  let cleaned = text
  if (chronoText) {
    cleaned = cleaned.replace(chronoText, '')
  }
  const wordsToStrip = [...URGENT_WORDS, ...IMPORTANT_WORDS, 'até', 'de', 'às']
  const pattern = new RegExp(`\\b(${wordsToStrip.join('|')})\\b`, 'gi')
  cleaned = cleaned.replace(pattern, '')
  return cleaned.replace(/\s{2,}/g, ' ').replace(/^[,\s-]+|[,\s-]+$/g, '').trim()
}

// Analisa um texto digitado em linguagem natural (pt-BR) e devolve
// uma estrutura pronta para virar evento (Calendar) ou tarefa (Tasks).
export function parseQuickAdd(text, referenceDate = new Date()) {
  const results = chrono.pt.parse(text, referenceDate, { forwardDate: true })
  const priority = detectPriority(text)

  if (results.length === 0) {
    return {
      type: 'task',
      title: cleanTitle(text),
      priority,
      due: null,
    }
  }

  const result = results[0]
  const start = result.start.date()
  const hasTime = result.start.isCertain('hour')
  const title = cleanTitle(text, result.text)

  if (hasTime) {
    const end = new Date(start.getTime() + 60 * 60 * 1000) // 1h de duração padrão
    return {
      type: 'event',
      title: title || 'Compromisso',
      priority,
      start,
      end,
    }
  }

  // Tem data mas não hora específica -> tarefa com prazo
  return {
    type: 'task',
    title: title || 'Tarefa',
    priority,
    due: start,
  }
}
