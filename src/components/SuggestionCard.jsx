import { useState } from 'react'
import { fromInputs } from '../lib/dates.js'
import { DEFAULT_PRIORITY } from '../lib/priority.js'
import { findDefaultCalendar, findListForPriority } from '../lib/defaults.js'

export const SUGGESTION_TYPE_LABEL = {
  evento: 'Agendar',
  tarefa: 'Tarefa',
  documento: 'Documento',
  contato: 'Falar com alguém',
  caso: 'Evoluir caso',
}

// Cartão de uma sugestão da IA (usado tanto nas anotações quanto nas
// tarefas): mostra o tipo, o texto, e um botão para criar de fato o evento
// ou a tarefa sugerida — exceto "documento", que nunca cria nada sozinho,
// só avisa que aquilo merece virar um documento de verdade escrito por fora
// do app.
export default function SuggestionCard({ suggestion, calendars, taskLists, onCreateEvent, onCreateTask }) {
  const [state, setState] = useState('idle') // idle | saving | done | error
  const podeAgir = suggestion.type !== 'documento'
  const viraEvento = suggestion.type === 'evento' && suggestion.date && suggestion.time

  async function criar() {
    setState('saving')
    try {
      if (viraEvento) {
        const start = fromInputs(suggestion.date, suggestion.time)
        const calendario = findDefaultCalendar(calendars) || calendars[0]
        await onCreateEvent({
          title: suggestion.title,
          start,
          end: new Date(start.getTime() + 60 * 60000),
          calendarId: calendario?.id,
        })
      } else {
        const lista = findListForPriority(taskLists, DEFAULT_PRIORITY)
        await onCreateTask({
          title: suggestion.title,
          priority: DEFAULT_PRIORITY,
          due: suggestion.date ? fromInputs(suggestion.date) : null,
          tasklistId: lista?.id,
        })
      }
      setState('done')
    } catch (err) {
      console.error('Não foi possível criar a partir da sugestão:', err)
      setState('error')
    }
  }

  return (
    <div className="suggestion">
      <div className="suggestion-type">{SUGGESTION_TYPE_LABEL[suggestion.type] || suggestion.type}</div>
      <div style={{ fontSize: 'var(--body-sm)', marginTop: 2 }}>{suggestion.text}</div>
      {podeAgir && state !== 'done' && (
        <button onClick={criar} disabled={state === 'saving'} style={{ marginTop: 6 }}>
          {state === 'saving' ? 'Criando...' : viraEvento ? 'Agendar' : 'Criar tarefa'}
        </button>
      )}
      {state === 'done' && <div className="muted" style={{ fontSize: 'var(--label-sm)', marginTop: 6 }}>✓ criado</div>}
      {state === 'error' && (
        <div className="muted" style={{ fontSize: 'var(--label-sm)', marginTop: 6 }}>Não deu certo — tente de novo.</div>
      )}
    </div>
  )
}
