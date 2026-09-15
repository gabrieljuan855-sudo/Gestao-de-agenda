import { useState } from 'react'
import Modal from './Modal.jsx'
import { toDateInput, fromInputs } from '../lib/dates.js'

const PRIORITIES = [
  { id: 'urgente', label: 'Urgente' },
  { id: 'importante', label: 'Importante' },
  { id: 'pode_esperar', label: 'Pode esperar' },
]

export default function TaskEditor({ task, onSave, onDelete, onReopen, onComplete, onClose }) {
  const [title, setTitle] = useState(task.title || '')
  const [due, setDue] = useState(task.due ? toDateInput(new Date(task.due)) : '')
  const [priority, setPriority] = useState(task.priority || 'pode_esperar')
  const [notes, setNotes] = useState(task.notesClean || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const done = task.status === 'completed'

  async function run(action, after) {
    setSaving(true)
    setError(null)
    try {
      await action()
      if (after) after()
      onClose()
    } catch (err) {
      setError(`Não deu certo: ${err.message}`)
      setSaving(false)
    }
  }

  function handleSave() {
    run(() =>
      onSave({
        title: title.trim(),
        due: due ? fromInputs(due) : null,
        priority,
        notes,
      })
    )
  }

  function handleDelete() {
    if (!window.confirm(`Excluir a tarefa "${task.title}"?`)) return
    run(onDelete)
  }

  return (
    <Modal title="Editar tarefa" onClose={onClose}>
      <label className="field">
        <span>Título</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label className="field">
        <span>Prazo</span>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>

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
        <span>Anotações</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {task.tasklistTitle && (
        <div className="muted" style={{ fontSize: 11 }}>Lista: {task.tasklistTitle}</div>
      )}

      {error && <div className="form-error">{error}</div>}

      <div className="modal-actions">
        <button onClick={handleDelete} disabled={saving} className="danger">Excluir</button>
        <div style={{ flex: 1 }} />
        {done ? (
          <button onClick={() => run(onReopen)} disabled={saving}>Reabrir</button>
        ) : (
          <button onClick={() => run(onComplete)} disabled={saving}>Concluir</button>
        )}
        <button className="primary" onClick={handleSave} disabled={saving || !title.trim()}>
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </Modal>
  )
}
