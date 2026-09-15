import { useEffect, useMemo, useState } from 'react'
import { searchEvents } from '../lib/googleApi.js'
import { formatTime } from '../lib/dates.js'
import { eventStart, isAllDay } from '../lib/events.js'
import { PRIORITY_LABEL } from '../lib/priority.js'

// Sem acento, sem caixa: "dienifer" acha "Dienifer", "audiência" acha
// "audiencia" e vice-versa. Ninguém para pra lembrar do acento certo achando
// uma coisa rápida.
function normalize(text) {
  return (text || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

function whenLabel(event) {
  const start = eventStart(event)
  const date = start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  return isAllDay(event) ? date : `${date} · ${formatTime(start)}`
}

// `search` é injetável (por padrão, a busca de verdade na API do Google) pra
// dar pra conferir o componente sozinho, sem precisar de login nem rede.
export default function SearchPanel({ tasks = [], onSelectEvent, onSelectTask, close, search = searchEvents }) {
  const [query, setQuery] = useState('')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const trimmed = query.trim()
  const ready = trimmed.length >= 2

  // As tarefas já estão todas carregadas (Google Tasks não tem busca por
  // texto na API); filtrar na hora é instantâneo e não pede rede nenhuma.
  const matchingTasks = useMemo(() => {
    if (!ready) return []
    const needle = normalize(trimmed)
    return tasks.filter(
      (t) => t.status !== 'completed' && (normalize(t.title).includes(needle) || normalize(t.notesClean).includes(needle))
    )
  }, [tasks, trimmed, ready])

  // Compromissos, por outro lado, vêm do Google: a busca deles não fica presa
  // ao período que a tela está mostrando (ver searchEvents), então pede rede
  // — daí o debounce, pra não disparar uma chamada a cada letra digitada.
  useEffect(() => {
    if (!ready) {
      setEvents([])
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const id = setTimeout(async () => {
      try {
        const found = await search(trimmed)
        if (!cancelled) setEvents(found)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [trimmed, ready, search])

  const nothingFound = ready && !loading && !error && matchingTasks.length === 0 && events.length === 0

  return (
    <div>
      <input
        type="text"
        autoFocus
        placeholder="Buscar compromissos e tarefas..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%' }}
      />

      {!trimmed && (
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          Busca nos compromissos dos últimos 6 meses e dos próximos 12, e nas suas tarefas.
        </div>
      )}
      {trimmed && !ready && (
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>Digite ao menos 2 letras.</div>
      )}
      {error && <div className="form-error" style={{ marginTop: 10 }}>Não deu para buscar: {error}</div>}

      {matchingTasks.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Tarefas</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {matchingTasks.map((task) => (
              <button
                key={task.id}
                className="search-result"
                onClick={() => {
                  onSelectTask(task)
                  close()
                }}
              >
                <span className={`pill ${task.priority}`} style={{ fontSize: 10, flexShrink: 0 }}>
                  {PRIORITY_LABEL[task.priority]}
                </span>
                <span className="search-result-text">{task.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Compromissos</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {events.map((event) => (
              <button
                key={event.id}
                className="search-result"
                onClick={() => {
                  onSelectEvent(event)
                  close()
                }}
              >
                <span className="week-dot" style={{ background: event.calendarColor || 'var(--accent)', flexShrink: 0 }} />
                <span className="search-result-text">{event.summary || '(sem título)'}</span>
                <span className="muted" style={{ fontSize: 11, flexShrink: 0 }}>{whenLabel(event)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>Buscando...</div>}
      {nothingFound && <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>Nada encontrado.</div>}
    </div>
  )
}
