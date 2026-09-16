import { useEffect, useMemo, useState } from 'react'
import { searchEvents, prefetchEventosDaBusca } from '../lib/googleApi.js'
import { formatTime } from '../lib/dates.js'
import { eventStart, isAllDay } from '../lib/events.js'
import { PRIORITY_LABEL } from '../lib/priority.js'
import { semAcento } from '../lib/texto.js'

function whenLabel(event) {
  const start = eventStart(event)
  const date = start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  const when = isAllDay(event) ? date : `${date} · ${formatTime(start)}`
  // Série recorrente: a data mostrada é a próxima ocorrência, e o "repete"
  // avisa que não é um compromisso solto.
  return event.repeatCount > 1 ? `${when} · repete` : when
}

// Buscar um nome comum pode casar com dezenas de compromissos. Mostrar todos
// vira uma lista que não se lê e um painel maior que a tela.
const MAX_RESULTS = 25

// `search` é injetável (por padrão, a busca de verdade na API do Google) pra
// dar pra conferir o componente sozinho, sem precisar de login nem rede.
export default function SearchPanel({ tasks = [], onSelectEvent, onSelectTask, close, search = searchEvents }) {
  const [query, setQuery] = useState('')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const trimmed = query.trim()
  const ready = trimmed.length >= 2

  // Pede os compromissos do período assim que o painel abre: quando as duas
  // primeiras letras terminam de ser digitadas, a lista normalmente já chegou,
  // e a busca sai instantânea.
  useEffect(() => {
    prefetchEventosDaBusca().catch(() => {
      // Falhou agora: a própria busca tenta de novo e aí sim mostra o erro.
    })
  }, [])

  // As tarefas já estão todas carregadas (Google Tasks não tem busca por
  // texto na API); filtrar na hora é instantâneo e não pede rede nenhuma.
  const matchingTasks = useMemo(() => {
    if (!ready) return []
    const needle = semAcento(trimmed)
    return tasks.filter(
      (t) => t.status !== 'completed' && (semAcento(t.title).includes(needle) || semAcento(t.notesClean).includes(needle))
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
        <div className="muted" style={{ marginTop: 10, fontSize: 'var(--label-md)' }}>
          Busca nos compromissos dos últimos 6 meses e dos próximos 12, e nas suas tarefas.
          Parte da palavra basta, e o acento não importa.
        </div>
      )}
      {trimmed && !ready && (
        <div className="muted" style={{ marginTop: 10, fontSize: 'var(--label-md)' }}>Digite ao menos 2 letras.</div>
      )}
      {error && <div className="form-error" style={{ marginTop: 10 }}>Não deu para buscar: {error}</div>}

      {matchingTasks.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="muted" style={{ fontSize: 'var(--label-sm)', marginBottom: 4 }}>Tarefas</div>
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
                <span className={`pill ${task.priority}`} style={{ fontSize: 'var(--label-xs)', flexShrink: 0 }}>
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
          <div className="muted" style={{ fontSize: 'var(--label-sm)', marginBottom: 4 }}>Compromissos</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {events.slice(0, MAX_RESULTS).map((event) => (
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
                <span className="muted" style={{ fontSize: 'var(--label-sm)', flexShrink: 0 }}>{whenLabel(event)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {events.length > MAX_RESULTS && (
        <div className="muted" style={{ marginTop: 6, fontSize: 'var(--label-sm)' }}>
          Mostrando {MAX_RESULTS} de {events.length}. Escreva mais para afinar a busca.
        </div>
      )}

      {loading && <div className="muted" style={{ marginTop: 10, fontSize: 'var(--label-md)' }}>Buscando...</div>}
      {nothingFound && <div className="muted" style={{ marginTop: 10, fontSize: 'var(--label-md)' }}>Nada encontrado.</div>}
    </div>
  )
}
