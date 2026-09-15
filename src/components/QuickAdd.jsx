import { useState } from 'react'
import { parseQuickAdd } from '../lib/nlp.js'
import { parseWithAI } from '../lib/aiParse.js'
import { formatDuration, toTimeInput, fromInputs, toDateInput } from '../lib/dates.js'

const PRIORITY_LABEL = {
  urgente: 'Urgente',
  importante: 'Importante',
  pode_esperar: 'Pode esperar',
}

const DURATION_OPTIONS = [20, 30, 45, 50, 60, 90, 120]

export default function QuickAdd({ calendars = [], taskLists = [], onCreateEvent, onCreateTask }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [calendarId, setCalendarId] = useState('')
  const [tasklistId, setTasklistId] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [startTime, setStartTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [asking, setAsking] = useState(false)
  const [usedAI, setUsedAI] = useState(false)

  function applyPreview(parsed) {
    setPreview(parsed)
    if (parsed?.type === 'event') {
      setMinutes(parsed.durationMinutes || 60)
      setStartTime(toTimeInput(parsed.start))
    }
    if (parsed?.calendarId) setCalendarId(parsed.calendarId)
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

  const isEvent = preview?.type === 'event'
  const needsCalendar = isEvent && calendars.length > 0 && !calendarId
  const needsList = !isEvent && taskLists.length > 0 && !tasklistId

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
        await onCreateTask({ ...preview, tasklistId })
      }
      setText('')
      setPreview(null)
      setCalendarId('')
      setTasklistId('')
    } catch (err) {
      setError(`Não deu para salvar: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
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

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <strong>{preview.title}</strong>
            <span className={`pill ${preview.priority}`}>{PRIORITY_LABEL[preview.priority]}</span>
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
                <label className="field">
                  <span>Lista</span>
                  <select value={tasklistId} onChange={(e) => setTasklistId(e.target.value)}>
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
