import { useState } from 'react'
import Modal from './Modal.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { toDateInput, toTimeInput, fromInputs } from '../lib/dates.js'
import { isAllDay, eventStart, eventEnd } from '../lib/events.js'

export default function EventEditor({ event, onSave, onDelete, onClose }) {
  const allDay = isAllDay(event)
  const start = eventStart(event)
  const end = eventEnd(event)

  const [title, setTitle] = useState(event.summary || '')
  const [date, setDate] = useState(toDateInput(start))
  const [endDate, setEndDate] = useState(toDateInput(end))
  const [startTime, setStartTime] = useState(allDay ? '09:00' : toTimeInput(start))
  const [endTime, setEndTime] = useState(allDay ? '10:00' : toTimeInput(end))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  async function handleSave() {
    const nextStart = allDay ? fromInputs(date) : fromInputs(date, startTime)
    const nextEnd = allDay ? fromInputs(endDate) : fromInputs(date, endTime)

    if (nextEnd <= nextStart) {
      setError(allDay ? 'O último dia não pode ser antes do primeiro.' : 'O fim precisa ser depois do início.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave({ title: title.trim(), start: nextStart, end: nextEnd, allDay })
      onClose()
    } catch (err) {
      setError(`Não deu para salvar: ${err.message}`)
      setSaving(false)
    }
  }

  async function handleDelete() {
    setSaving(true)
    try {
      await onDelete()
      onClose()
    } catch (err) {
      setError(`Não deu para excluir: ${err.message}`)
      setSaving(false)
    }
  }

  return (
    <>
      <Modal title="Editar compromisso" onClose={onClose}>
        <label className="field">
          <span>Título</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        {allDay ? (
          <div className="field-row">
            <label className="field">
              <span>Primeiro dia</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Último dia</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
        ) : (
          <>
            <label className="field">
              <span>Data</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Início</span>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </label>
              <label className="field">
                <span>Fim</span>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </label>
            </div>
          </>
        )}

        {event.calendarSummary && (
          <div className="muted" style={{ fontSize: 'var(--label-sm)' }}>
            Agenda: {event.calendarSummary}
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button onClick={() => setConfirmingDelete(true)} disabled={saving} className="danger">Excluir</button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="primary" onClick={handleSave} disabled={saving || !title.trim()}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </Modal>

      {confirmingDelete && (
        <ConfirmDialog
          title="Excluir compromisso"
          message={`Excluir "${event.summary}" da sua agenda?`}
          confirmLabel="Excluir"
          danger
          onConfirm={() => {
            setConfirmingDelete(false)
            handleDelete()
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  )
}
