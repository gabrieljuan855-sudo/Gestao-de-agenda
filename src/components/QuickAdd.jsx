import { useEffect, useState } from 'react'
import { parseQuickAdd } from '../lib/nlp.js'
import { parseWithAI } from '../lib/aiParse.js'
import { formatDuration, toTimeInput, fromInputs, toDateInput } from '../lib/dates.js'
import { PRIORITIES, DEFAULT_PRIORITY, priorityFromListTitle } from '../lib/priority.js'

const DURATION_OPTIONS = [20, 30, 45, 50, 60, 90, 120]

// A agenda de trabalho é onde quase tudo cai. Deixar "Escolha a agenda..." em
// branco obrigava um clique a mais em todo compromisso, e bloqueava o botão de
// salvar até que ele fosse dado.
const DEFAULT_CALENDAR = 'creas'

function findDefaultCalendar(calendars) {
  const named = (cal) => (cal.summaryOverride || cal.summary || '').toLowerCase()
  return calendars.find((cal) => named(cal).includes(DEFAULT_CALENDAR)) || null
}

function findListForPriority(taskLists, priority) {
  return taskLists.find((list) => priorityFromListTitle(list.title) === priority) || null
}

export default function QuickAdd({ calendars = [], taskLists = [], onCreateEvent, onCreateTask, onDone }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [calendarId, setCalendarId] = useState('')
  const [tasklistId, setTasklistId] = useState('')
  const [priority, setPriority] = useState(DEFAULT_PRIORITY)
  const [minutes, setMinutes] = useState(60)
  const [startTime, setStartTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [asking, setAsking] = useState(false)
  const [usedAI, setUsedAI] = useState(false)

  // As agendas chegam depois do primeiro render (vêm da API), por isso o padrão
  // é aplicado aqui e não no useState.
  useEffect(() => {
    if (calendarId) return
    const preferred = findDefaultCalendar(calendars)
    if (preferred) setCalendarId(preferred.id)
  }, [calendars, calendarId])

  // Prioridade e lista são a mesma coisa no Google Tasks do usuário: as listas
  // se chamam "Prioridade Máxima", "Prioridade Média"... Então escolher uma
  // move a outra junto, em vez de pedir a mesma informação duas vezes.
  useEffect(() => {
    const list = findListForPriority(taskLists, priority)
    if (list) setTasklistId(list.id)
  }, [taskLists, priority])

  function applyPreview(parsed) {
    setPreview(parsed)
    if (parsed?.type === 'event') {
      setMinutes(parsed.durationMinutes || 60)
      setStartTime(toTimeInput(parsed.start))
    }
    if (parsed?.calendarId) setCalendarId(parsed.calendarId)
    // O texto só muda a prioridade quando diz algo ("urgente", "prazo"); do
    // contrário o que estiver selecionado continua valendo.
    if (parsed?.priority) setPriority(parsed.priority)
  }

  async function handleAskAI() {
    setAsking(true)
    setError(null)
    try {
      applyPreview(await parseWithAI(text, calendars))
      setUsedAI(true)
    } catch (err) {
      setError(`A IA não conseguiu: ${err.message}`)
    } finally {
      setAsking(false)
    }
  }

  function handleChange(value) {
    setText(value)
    setError(null)
    setUsedAI(false)
    applyPreview(value.trim() ? parseQuickAdd(value) : null)
  }

  function handleListChange(id) {
    setTasklistId(id)
    const list = taskLists.find((l) => l.id === id)
    const fromList = list && priorityFromListTitle(list.title)
    if (fromList) setPriority(fromList)
  }

  const isEvent = preview?.type === 'event'
  const needsCalendar = isEvent && calendars.length > 0 && !calendarId
  const needsList = !isEvent && taskLists.length > 0 && !tasklistId

  function resetDefaults() {
    setText('')
    setPreview(null)
    setPriority(DEFAULT_PRIORITY)
    const preferred = findDefaultCalendar(calendars)
    setCalendarId(preferred ? preferred.id : '')
  }

  async function handleConfirm() {
    if (!preview) return
    setSaving(true)
    setError(null)
    try {
      if (isEvent) {
        const start = fromInputs(toDateInput(preview.start), startTime)
        const end = new Date(start.getTime() + minutes * 60000)
        await onCreateEvent({ ...preview, start, end, calendarId })
      } else {
        await onCreateTask({ ...preview, priority, tasklistId })
      }
      resetDefaults()
      onDone && onDone()
    } catch (err) {
      setError(`Não deu para salvar: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <input
        type="text"
        placeholder="Ex: Reunião de equipe terça 13h15 por 50min"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        style={{ width: '100%' }}
      />

      {preview && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span className="muted">{usedAI ? 'A IA entendeu assim:' : 'Entendi assim:'}</span>
            <button onClick={handleAskAI} disabled={asking || !text.trim()}>
              {asking ? 'Interpretando...' : 'Interpretar com IA'}
            </button>
          </div>

          <div style={{ marginBottom: 10 }}>
            <strong>{preview.title}</strong>
          </div>

          <div className="quickadd-fields">
            {isEvent ? (
              <>
                <label className="field">
                  <span>Dia</span>
                  <input
                    type="date"
                    value={toDateInput(preview.start)}
                    onChange={(e) =>
                      setPreview({ ...preview, start: fromInputs(e.target.value, startTime) })
                    }
                  />
                </label>
                <label className="field">
                  <span>Início</span>
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </label>
                <label className="field">
                  <span>Duração</span>
                  <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                    {[...new Set([...DURATION_OPTIONS, minutes])]
                      .sort((a, b) => a - b)
                      .map((m) => (
                        <option key={m} value={m}>{formatDuration(m)}</option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span>Agenda</span>
                  <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
                    <option value="">Escolha a agenda...</option>
                    {calendars.map((cal) => (
                      <option key={cal.id} value={cal.id}>{cal.summaryOverride || cal.summary}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                {preview.due && (
                  <label className="field">
                    <span>Prazo</span>
                    <input
                      type="date"
                      value={toDateInput(preview.due)}
                      onChange={(e) => setPreview({ ...preview, due: fromInputs(e.target.value) })}
                    />
                  </label>
                )}
                <div className="field">
                  <span>Prioridade</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {PRIORITIES.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setPriority(p.id)}
                        className={`pill ${p.id}`}
                        style={{
                          border: priority === p.id ? '2px solid var(--text-primary)' : '1px solid transparent',
                          cursor: 'pointer',
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="field">
                  <span>Lista</span>
                  <select value={tasklistId} onChange={(e) => handleListChange(e.target.value)}>
                    <option value="">Escolha a lista...</option>
                    {taskLists.map((list) => (
                      <option key={list.id} value={list.id}>{list.title}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>

          {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}

          <button
            className="primary"
            style={{ marginTop: 10 }}
            onClick={handleConfirm}
            disabled={saving || needsCalendar || needsList}
          >
            {saving ? 'Salvando...' : isEvent ? 'Criar compromisso' : 'Criar tarefa'}
          </button>
        </div>
      )}
    </div>
  )
}
