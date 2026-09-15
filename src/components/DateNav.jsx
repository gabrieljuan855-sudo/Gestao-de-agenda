import { startOfWeek, endOfWeek, isToday } from '../lib/dates.js'

function label(view, reference) {
  if (view === 'week') {
    const start = startOfWeek(reference)
    const end = endOfWeek(reference)
    const sameMonth = start.getMonth() === end.getMonth()
    const startLabel = start.toLocaleDateString('pt-BR', { day: '2-digit', month: sameMonth ? undefined : 'short' })
    const endLabel = end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    return `${startLabel} – ${endLabel}`
  }
  if (view === 'month') {
    return reference.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  }
  return reference.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
}

export default function DateNav({ view, reference, onPrev, onNext, onToday }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <button onClick={onPrev} aria-label="Período anterior">←</button>
      <div style={{ flex: 1, textAlign: 'center', fontWeight: 500, fontSize: 14 }}>
        {label(view, reference)}
      </div>
      <button onClick={onNext} aria-label="Próximo período">→</button>
      {!isToday(reference) && <button onClick={onToday}>Hoje</button>}
    </div>
  )
}
