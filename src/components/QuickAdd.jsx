import { useState } from 'react'
import { parseQuickAdd } from '../lib/nlp.js'

const PRIORITY_LABEL = {
  urgente: 'Urgente',
  importante: 'Importante',
  pode_esperar: 'Pode esperar',
}

export default function QuickAdd({ onCreateEvent, onCreateTask }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)

  function handleChange(value) {
    setText(value)
    setPreview(value.trim() ? parseQuickAdd(value) : null)
  }

  async function handleConfirm() {
    if (!preview) return
    if (preview.type === 'event') {
      await onCreateEvent(preview)
    } else {
      await onCreateTask(preview)
    }
    setText('')
    setPreview(null)
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <input
        type="text"
        placeholder="Ex: reunião quarta 14h, ou ligar pra escola até sexta"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        style={{ width: '100%' }}
      />

      {preview && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div className="muted" style={{ marginBottom: 6 }}>Entendi assim:</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
            <span><strong>Tipo:</strong> {preview.type === 'event' ? 'compromisso' : 'tarefa'}</span>
            {preview.start && (
              <span><strong>Quando:</strong> {preview.start.toLocaleString('pt-BR')}</span>
            )}
            {preview.due && (
              <span><strong>Prazo:</strong> {preview.due.toLocaleDateString('pt-BR')}</span>
            )}
            <span className={`pill ${preview.priority}`}>{PRIORITY_LABEL[preview.priority]}</span>
          </div>
          <button className="primary" onClick={handleConfirm}>Confirmar</button>
        </div>
      )}
    </div>
  )
}
