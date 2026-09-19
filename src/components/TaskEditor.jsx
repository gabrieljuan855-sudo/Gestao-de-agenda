import { useState } from 'react'
import Modal from './Modal.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import SuggestionCard from './SuggestionCard.jsx'
import { toDateInput, fromInputs, dateOnlyFromISO } from '../lib/dates.js'
import { PRIORITIES, DEFAULT_PRIORITY } from '../lib/priority.js'
import { analyzeNoteWithAI } from '../lib/aiAnalyzeNote.js'
import { APENAS_AGENTE_ATIVO } from '../lib/aiCooldown.js'

// Uma tarefa é curta demais para valer a pena mandar para a IA (ex: só
// "Ligar" sem mais nada) — mesmo piso usado nas anotações.
const AI_MIN_LENGTH = 10

export default function TaskEditor({
  task,
  onSave,
  onDelete,
  onReopen,
  onComplete,
  onClose,
  calendars = [],
  taskLists = [],
  onCreateEvent,
  onCreateTask,
}) {
  const [title, setTitle] = useState(task.title || '')
  // dateOnlyFromISO, não `new Date(task.due)`: o prazo vem do Google como
  // meia-noite UTC, e o fuso do Brasil mostrava sempre um dia antes do real.
  const [due, setDue] = useState(task.due ? toDateInput(dateOnlyFromISO(task.due)) : '')
  const [priority, setPriority] = useState(task.priority || DEFAULT_PRIORITY)
  const [notes, setNotes] = useState(task.notesClean || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Sugestões da IA para esta tarefa: vivem só nesta sessão de edição — o
  // Google Tasks não tem um campo próprio para guardar isso junto da tarefa
  // (diferente das anotações, que têm o arquivo JSON no Drive só delas), e
  // pedir de novo é barato o bastante para não precisar persistir.
  const [analyzing, setAnalyzing] = useState(false)
  const [suggestions, setSuggestions] = useState(null)
  const [analyzeError, setAnalyzeError] = useState(null)

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
    run(onDelete)
  }

  async function handleAnalyze() {
    setAnalyzing(true)
    setAnalyzeError(null)
    try {
      const texto = `${title}\n${notes}`.trim()
      const { suggestions: novas } = await analyzeNoteWithAI(texto)
      setSuggestions(novas)
    } catch (err) {
      console.error('Não foi possível analisar a tarefa:', err)
      setAnalyzeError('Não deu para analisar agora — tente de novo em instantes.')
    } finally {
      setAnalyzing(false)
    }
  }

  const podeAnalisar = `${title}${notes}`.trim().length >= AI_MIN_LENGTH

  return (
    <>
      <Modal title="Editar tarefa" onClose={onClose}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSave()
          }}
        >
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
                type="button"
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

        {/* Ver APENAS_AGENTE_ATIVO em aiCooldown.js — este botão escapava do
            interruptor, e o teste de limite de cota acabava medindo duas
            superfícies de IA em vez de uma. */}
        {!APENAS_AGENTE_ATIVO && (
          <div style={{ marginBottom: 10 }}>
            <button type="button" onClick={handleAnalyze} disabled={analyzing || !podeAnalisar}>
              {analyzing ? 'Analisando...' : '✨ Analisar com IA'}
            </button>
            {analyzeError && <div className="form-error" style={{ marginTop: 6 }}>{analyzeError}</div>}
            {suggestions && (
              suggestions.length === 0 ? (
                <div className="muted" style={{ fontSize: 'var(--label-sm)', marginTop: 6 }}>
                  Nada de especial notado nesta tarefa.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {suggestions.map((s, i) => (
                    <SuggestionCard
                      key={i}
                      suggestion={s}
                      calendars={calendars}
                      taskLists={taskLists}
                      onCreateEvent={onCreateEvent}
                      onCreateTask={onCreateTask}
                    />
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {task.tasklistTitle && (
          <div className="muted" style={{ fontSize: 'var(--label-sm)' }}>Lista: {task.tasklistTitle}</div>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" onClick={() => setConfirmingDelete(true)} disabled={saving} className="danger">Excluir</button>
          <div style={{ flex: 1 }} />
          {done ? (
            <button type="button" onClick={() => run(onReopen)} disabled={saving}>Reabrir</button>
          ) : (
            <button type="button" onClick={() => run(onComplete)} disabled={saving}>Concluir</button>
          )}
          <button type="submit" className="primary" disabled={saving || !title.trim()}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
        </form>
      </Modal>

      {confirmingDelete && (
        <ConfirmDialog
          title="Excluir tarefa"
          message={`Excluir a tarefa "${task.title}"?`}
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
