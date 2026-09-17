import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'
import Banner from './Banner.jsx'

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

// Título e corpo ficam com estado próprio aqui dentro, sincronizado com a
// nota selecionada só depois de uma pausa na digitação — o mesmo motivo de
// sempre: gravar a cada tecla gastaria uma chamada ao Drive por letra.
function NoteEditor({ note, onChange, onBack, onDelete }) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const firstRender = useRef(true)

  // Trocar de nota reseta o campo para o conteúdo dela, sem disparar uma
  // gravação (é troca de tela, não edição).
  useEffect(() => {
    setTitle(note.title)
    setBody(note.body)
    firstRender.current = true
  }, [note.id])

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const id = setTimeout(() => onChange({ title, body }), 500)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body])

  return (
    <>
      <div className="panel-head">
        <button onClick={onBack}>← Notas</button>
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
      </div>

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
// Drive) mora em useNotes — este componente só existe enquanto o painel do
// trilho está aberto, e as anotações precisam sobreviver a ele fechar.
export default function Notes({ notesState }) {
  const { notes, selectedId, setSelectedId, loading, error, dismissError, createNote, updateNote, deleteNote } =
    notesState
  const selected = notes.find((n) => n.id === selectedId)

  if (selected) {
    return (
      <NoteEditor
        note={selected}
        onChange={(patch) => updateNote(selected.id, patch)}
        onBack={() => setSelectedId(null)}
        onDelete={() => deleteNote(selected.id)}
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
            <span className="muted" style={{ fontSize: 'var(--label-sm)', flexShrink: 0 }}>
              {relativeUpdated(note.updatedAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
