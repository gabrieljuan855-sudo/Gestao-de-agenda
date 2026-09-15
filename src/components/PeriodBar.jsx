import { startOfWeek, endOfWeek, isToday } from '../lib/dates.js'

const VIEWS = [
  { id: 'day', label: 'Dia' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mês' },
]

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
  return reference.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
}

// Trocar de período e trocar de visão viraram a mesma barra: as setas andam
// no que estiver selecionado, então separá-las em duas linhas só gastava
// altura e obrigava a procurar em dois lugares.
export default function PeriodBar({ view, onChangeView, reference, onPrev, onNext, onToday }) {
  return (
    <div className="period-bar">
      <button onClick={onPrev} aria-label="Período anterior" className="period-arrow">←</button>

      <div className="period-views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => onChangeView(v.id)}
            className={view === v.id ? 'period-view is-on' : 'period-view'}
          >
            {v.label}
          </button>
        ))}
      </div>

      <button onClick={onNext} aria-label="Próximo período" className="period-arrow">→</button>

      <div className="period-label">{label(view, reference)}</div>

      {!isToday(reference) && <button onClick={onToday}>Hoje</button>}
    </div>
  )
}
