import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'
import Banner from './Banner.jsx'
import { fromInputs } from '../lib/dates.js'
import { DEFAULT_PRIORITY } from '../lib/priority.js'
import { findDefaultCalendar, findListForPriority } from '../lib/defaults.js'

// Tempo parado depois da última tecla para considerar que a anotação foi
// "finalizada" e vale a pena gastar uma chamada de IA nela. Bem mais longo
// que o do QuickAdd: aqui o texto é livre e pode crescer por minutos antes
// de a pessoa realmente terminar o pensamento.
const AI_IDLE_MS = 45000
const AI_MIN_LENGTH = 10

function snippetOf(note) {
  if (note.title?.trim()) return note.title.trim()
  const firstLine = (note.body || '').split('\n').find((l) => l.trim())
  return firstLine ? firstLine.trim().slice(0, 60) : '(sem título)'
}

function relativeUpdated(iso) {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `há ${diffMin}min`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `há ${diffH}h`
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

const TYPE_LABEL = {
  evento: 'Agendar',
  tarefa: 'Tarefa',
  documento: 'Documento',
  contato: 'Falar com alguém',
  caso: 'Evoluir caso',
}

function SuggestionCard({ suggestion, calendars, taskLists, onCreateEvent, onCreateTask }) {
  const [state, setState] = useState('idle') // idle | saving | done | error
  // "documento" nunca cria nada — é só o aviso de que aquilo merece virar um
  // documento de verdade, escrito por fora do app.
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
      <div className="suggestion-type">{TYPE_LABEL[suggestion.type] || suggestion.type}</div>
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

// Título e corpo ficam com estado próprio aqui dentro, sincronizado com a
// nota selecionada só depois de uma pausa na digitação — o mesmo motivo de
// sempre: gravar a cada tecla gastaria uma chamada ao Drive por letra. A IA
// tem seu próprio timer, bem mais longo (ver AI_IDLE_MS): a ideia é analisar
// quando a anotação estiver "pronta", não a cada pausa curta de digitação.
function NoteEditor({ note, onChange, onBack, onDelete, onAnalyze, analyzing, calendars, taskLists, onCreateEvent, onCreateTask }) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const firstRender = useRef(true)
  const saveTimer = useRef(null)
  const aiTimer = useRef(null)
  // O que já foi mandado para a IA nesta nota, para não repetir a mesma
  // análise sem nada ter mudado desde a última vez.
  const analyzedBodyRef = useRef(note.body)

  // Trocar de nota reseta os campos para o conteúdo dela, sem disparar
  // gravação nem análise — é troca de tela, não edição.
  useEffect(() => {
    setTitle(note.title)
    setBody(note.body)
    analyzedBodyRef.current = note.body
    firstRender.current = true
    clearTimeout(saveTimer.current)
    clearTimeout(aiTimer.current)
  }, [note.id])

  function maybeAnalyze(currentBody) {
    if (currentBody.trim().length < AI_MIN_LENGTH) return
    if (currentBody === analyzedBodyRef.current) return
    analyzedBodyRef.current = currentBody
    onAnalyze(note.id, currentBody)
  }

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => onChange({ title, body }), 500)

    clearTimeout(aiTimer.current)
    aiTimer.current = setTimeout(() => maybeAnalyze(body), AI_IDLE_MS)

    return () => {
      clearTimeout(saveTimer.current)
      clearTimeout(aiTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body])

  // Sair do editor é "terminar" a anotação: grava na hora (sem esperar os
  // 500ms) e, se sobrou conteúdo novo sem analisar, manda para a IA — é
  // exatamente o gatilho de "depois que eu terminar" que foi pedido.
  function handleBack() {
    clearTimeout(saveTimer.current)
    clearTimeout(aiTimer.current)
    onChange({ title, body })
    maybeAnalyze(body)
    onBack()
  }

  const suggestions = note.suggestions || []

  return (
    <>
      <div className="panel-head">
        <button onClick={handleBack}>← Notas</button>
        <button onClick={() => setConfirmingDelete(true)} style={{ marginLeft: 'auto' }}>Excluir</button>
      </div>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título (a IA sugere um, se deixar em branco)"
        style={{ width: '100%', marginBottom: 8, fontWeight: 500 }}
      />

      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Espaço livre para rascunhar, pensar em voz alta, colar algo que você não quer perder..."
        rows={12}
      />

      <div className="muted" style={{ fontSize: 'var(--label-sm)', marginTop: 6 }}>
        Sincronizado com o Drive — some no Google, some em qualquer aparelho.
        {analyzing && ' · revisando com a IA...'}
      </div>

      {suggestions.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="muted" style={{ fontSize: 'var(--label-sm)', marginBottom: 4 }}>A IA notou isto aqui:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Excluir anotação"
          message="Excluir esta anotação? Isso vale para todos os seus aparelhos."
          confirmLabel="Excluir"
          danger
          onConfirm={() => {
            setConfirmingDelete(false)
            onDelete()
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  )
}

// O estado de verdade (a lista, a nota selecionada, a sincronização com o
// Drive, a análise por IA) mora em useNotes — este componente só existe
// enquanto o painel do trilho está aberto.
export default function Notes({ notesState, calendars = [], taskLists = [], onCreateEvent, onCreateTask }) {
  const {
    notes,
    selectedId,
    setSelectedId,
    loading,
    error,
    dismissError,
    createNote,
    updateNote,
    deleteNote,
    analyzeNote,
    analyzingIds,
  } = notesState
  const selected = notes.find((n) => n.id === selectedId)

  if (selected) {
    return (
      <NoteEditor
        note={selected}
        onChange={(patch) => updateNote(selected.id, patch)}
        onBack={() => setSelectedId(null)}
        onDelete={() => deleteNote(selected.id)}
        onAnalyze={analyzeNote}
        analyzing={analyzingIds.has(selected.id)}
        calendars={calendars}
        taskLists={taskLists}
        onCreateEvent={onCreateEvent}
        onCreateTask={onCreateTask}
      />
    )
  }

  const ordenadas = [...notes].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))

  return (
    <div>
      <div className="panel-head">
        <span className="muted">
          {loading ? 'Carregando...' : `${notes.length} ${notes.length === 1 ? 'anotação' : 'anotações'}`}
        </span>
        <button className="primary" onClick={createNote} style={{ marginLeft: 'auto' }}>+ Nova</button>
      </div>

      {error && (
        <Banner tone="warning" actionLabel="✕" onAction={dismissError}>
          {error}
        </Banner>
      )}

      {ordenadas.length === 0 && !loading && (
        <div className="muted" style={{ marginTop: 10 }}>Nada por aqui ainda. Toque em "+ Nova" para começar.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {ordenadas.map((note) => (
          <button
            key={note.id}
            className="search-result"
            onClick={() => setSelectedId(note.id)}
            style={{ textAlign: 'left' }}
          >
            <span className="search-result-text">{snippetOf(note)}</span>
            {note.suggestions?.length > 0 && <span title="Tem sugestões da IA">✨</span>}
            <span className="muted" style={{ fontSize: 'var(--label-sm)', flexShrink: 0 }}>
              {relativeUpdated(note.updatedAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
