import { useEffect, useRef, useState } from 'react'
import { parseQuickAdd } from '../lib/nlp.js'
import { formatDuration, toTimeInput, fromInputs, toDateInput } from '../lib/dates.js'
import { findDefaultCalendar } from '../lib/defaults.js'

const DURATION_OPTIONS = [20, 30, 45, 50, 60, 90, 120]

// Capturar e organizar são dois gestos diferentes, e misturá-los era o que
// encarecia o mais importante dos dois.
//
// Antes, toda captura obrigava a decidir na hora: é evento ou tarefa? qual
// prioridade? qual lista? Três decisões para guardar um pensamento de cinco
// segundos — e é exatamente por isso que as coisas continuavam na cabeça (ou
// no papel). Agora o caminho padrão é um campo e Enter: o texto cai na
// Entrada como está, e o que aquilo *é* fica para depois, no momento próprio
// de decidir.
//
// O parser local (parseQuickAdd) continua rodando a cada tecla, mas mudou de
// papel: ele não decide mais nada, só enriquece. Achou um prazo? vai junto,
// de graça. Achou dia E hora certos? aí é quase sempre um compromisso de
// verdade — o único caso que vale o desvio, porque compromisso marcado é o
// que precisa entrar no calendário na hora, não depois.
export default function QuickAdd({
  calendars = [],
  onCapture,
  onCreateEvent,
  onDone,
}) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  // 'capturar' é o caminho de sempre; 'agendar' só quando a pessoa pede.
  const [modo, setModo] = useState('capturar')
  const [calendarId, setCalendarId] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [startTime, setStartTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [capturado, setCapturado] = useState(false)
  const inputRef = useRef(null)

  // As agendas chegam depois do primeiro render (vêm da API), por isso o padrão
  // é aplicado aqui e não no useState.
  useEffect(() => {
    if (calendarId) return
    const preferred = findDefaultCalendar(calendars) || calendars[0]
    if (preferred) setCalendarId(preferred.id)
  }, [calendars, calendarId])

  function handleChange(value) {
    setText(value)
    setError(null)
    setCapturado(false)
    const parsed = value.trim() ? parseQuickAdd(value) : null
    setPreview(parsed)
    if (parsed?.type === 'event') {
      setMinutes(parsed.durationMinutes || 60)
      setStartTime(toTimeInput(parsed.start))
    }
    // Voltar a digitar desfaz o desvio: o padrão é sempre capturar.
    if (modo === 'agendar' && parsed?.type !== 'event') setModo('capturar')
  }

  // O texto vai cru para a Entrada, e é de propósito: o título limpo pelo
  // parser é um palpite, e palpite errado na captura perde informação que a
  // pessoa não vai lembrar depois. O prazo, esse sim, vai junto quando o
  // parser achou — é de graça e não apaga nada do texto.
  async function capturar() {
    const limpo = text.trim()
    if (!limpo) return
    setSaving(true)
    setError(null)
    try {
      await onCapture({ texto: limpo, due: preview?.type === 'task' ? preview.due : null })
      setText('')
      setPreview(null)
      setCapturado(true)
      // O campo continua aberto e com o cursor dentro: esvaziar a cabeça
      // costuma vir em rajada, uma coisa puxando a outra.
      inputRef.current?.focus()
    } catch (err) {
      setError(`Não deu para capturar: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function agendar() {
    if (!preview) return
    setSaving(true)
    setError(null)
    try {
      const start = fromInputs(toDateInput(preview.start), startTime)
      const end = new Date(start.getTime() + minutes * 60000)
      await onCreateEvent({ ...preview, start, end, calendarId })
      setText('')
      setPreview(null)
      setModo('capturar')
      const preferred = findDefaultCalendar(calendars)
      setCalendarId(preferred ? preferred.id : '')
      onDone && onDone()
    } catch (err) {
      setError(`Não deu para salvar: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const pareceCompromisso = preview?.type === 'event'
  const agendando = modo === 'agendar' && pareceCompromisso
  const precisaAgenda = agendando && calendars.length > 0 && !calendarId

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (agendando) agendar()
        else capturar()
      }}
    >
      <input
        ref={inputRef}
        type="text"
        autoFocus
        placeholder="O que está na sua cabeça?"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        style={{ width: '100%' }}
      />

      {!agendando && (
        <>
          <button type="submit" className="primary" style={{ marginTop: 10 }} disabled={saving || !text.trim()}>
            {saving ? 'Capturando...' : 'Capturar'}
          </button>

          {capturado && !text && (
            <div className="muted" style={{ fontSize: 'var(--label-sm)', marginTop: 8 }}>
              ✓ Guardado na Entrada. Pode mandar a próxima.
            </div>
          )}

          {/* O único desvio que vale: compromisso com dia e hora marcados
              precisa entrar no calendário agora, não na próxima triagem. */}
          {pareceCompromisso && (
            <div className="quickadd-desvio">
              <span className="muted">
                Parece compromisso: {toDateInput(preview.start).split('-').reverse().slice(0, 2).join('/')} às{' '}
                {toTimeInput(preview.start)}
              </span>
              <button type="button" onClick={() => setModo('agendar')}>
                Agendar
              </button>
            </div>
          )}
        </>
      )}

      {agendando && (
        <div style={{ marginTop: 10, fontSize: 'var(--body-sm)' }}>
          <div style={{ marginBottom: 10 }}>
            <strong>{preview.title}</strong>
          </div>

          <div className="quickadd-fields">
            <label className="field">
              <span>Dia</span>
              <input
                type="date"
                value={toDateInput(preview.start)}
                onChange={(e) => setPreview({ ...preview, start: fromInputs(e.target.value, startTime) })}
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
          </div>

          {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <button type="submit" className="primary" disabled={saving || precisaAgenda}>
              {saving ? 'Salvando...' : 'Criar compromisso'}
            </button>
            <button type="button" onClick={() => setModo('capturar')} disabled={saving}>
              Só capturar
            </button>
          </div>
        </div>
      )}

      {error && !agendando && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
    </form>
  )
}
