import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'
import Banner from './Banner.jsx'
import SuggestionCard from './SuggestionCard.jsx'
import { AI_MIN_LENGTH, descreverSincronizacao } from '../lib/useNotes.js'
import { APENAS_AGENTE_ATIVO } from '../lib/aiCooldown.js'

// Tempo parado depois da última tecla para considerar que a anotação foi
// "finalizada" e vale a pena gastar uma chamada de IA nela. Bem mais longo
// que o do QuickAdd: aqui o texto é livre e pode crescer por minutos antes
// de a pessoa realmente terminar o pensamento.
const AI_IDLE_MS = 45000

function snippetOf(note) {
  if (note.title?.trim()) return note.title.trim()
  const firstLine = (note.body || '').split('\n').find((l) => l.trim())
  return firstLine ? firstLine.trim().slice(0, 60) : '(sem título)'
}

// Título e corpo ficam com estado próprio aqui dentro, sincronizado com a
// nota selecionada só depois de uma pausa na digitação — o mesmo motivo de
// sempre: gravar a cada tecla gastaria uma chamada ao Drive por letra. A IA
// tem seu próprio timer, bem mais longo (ver AI_IDLE_MS): a ideia é analisar
// quando a anotação estiver "pronta", não a cada pausa curta de digitação.
function NoteEditor({ note, onChange, onAnalyze, analyzing, syncStatus, calendars, taskLists, onCreateEvent, onCreateTask, onSelectRelated }) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const firstRender = useRef(true)
  const saveTimer = useRef(null)
  const aiTimer = useRef(null)
  // O que já foi mandado para a IA nesta nota, para não repetir a mesma
  // análise sem nada ter mudado desde a última vez.
  const analyzedBodyRef = useRef(note.body)
  // O último título vindo de fora (não da digitação aqui dentro). É contra
  // ele que se decide se um note.title novo é a IA preenchendo um título
  // vazio (sincroniza o campo) ou o eco da própria gravação que este editor
  // acabou de mandar (ignora — repetir a gravação só gastaria outra chamada
  // ao Drive à toa).
  const lastKnownTitleRef = useRef(note.title)
  const syncingTitleRef = useRef(false)

  // Trocar de nota reseta os campos para o conteúdo dela, sem disparar
  // gravação nem análise — é troca de tela, não edição.
  useEffect(() => {
    setTitle(note.title)
    setBody(note.body)
    analyzedBodyRef.current = note.body
    lastKnownTitleRef.current = note.title
    firstRender.current = true
    clearTimeout(saveTimer.current)
    clearTimeout(aiTimer.current)
  }, [note.id])

  // A IA pode preencher o título enquanto esta mesma nota continua aberta: a
  // análise roda 45s depois de parar de digitar, e a pessoa nem sempre troca
  // de aba nesse meio tempo. Sem isto, o campo ficava em branco na tela mesmo
  // com o título já gravado por baixo, porque o efeito acima só reage a troca
  // de nota, nunca ao próprio campo mudar por fora.
  useEffect(() => {
    if (note.title === lastKnownTitleRef.current) return
    // Só assume o valor de fora se a pessoa não tiver digitado o próprio
    // título desde a última vez que os dois bateram — senão a sugestão da IA
    // atropelaria o que ela acabou de escrever.
    if (title === lastKnownTitleRef.current) {
      syncingTitleRef.current = true
      setTitle(note.title)
    }
    lastKnownTitleRef.current = note.title
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.title])

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
    if (syncingTitleRef.current) {
      syncingTitleRef.current = false
      return
    }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => onChange({ title, body }), 500)

    // Ver APENAS_AGENTE_ATIVO em aiCooldown.js — teste de limite de cota em
    // andamento, só o agente deve chamar o Gemini por enquanto.
    if (!APENAS_AGENTE_ATIVO) {
      clearTimeout(aiTimer.current)
      aiTimer.current = setTimeout(() => maybeAnalyze(body), AI_IDLE_MS)
    }

    return () => {
      clearTimeout(saveTimer.current)
      clearTimeout(aiTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body])

  const suggestions = note.suggestions || []

  return (
    <>
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

      <div className="notes-status">
        <StatusDoDrive status={syncStatus} />
        {analyzing && <span>· revisando com a IA...</span>}
        <button type="button" className="notes-print-btn" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>

      {/* Só isto fica visível na hora de imprimir (ver @media print em
          index.css) — título e input/textarea têm bordas, placeholder e
          podem cortar texto que não cabe na altura visível deles. */}
      <div className="notes-print-only" aria-hidden="true">
        <h1>{title.trim() || '(sem título)'}</h1>
        {body.split('\n').map((linha, i) => (
          <p key={i}>{linha || ' '}</p>
        ))}
      </div>

      {note.relatedNote && (
        <Banner tone="info" actionLabel="Abrir" onAction={() => onSelectRelated(note.relatedNote.id)}>
          A IA notou que isto parece relacionado a "{note.relatedNote.title || '(sem título)'}".
        </Banner>
      )}

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
    </>
  )
}

// O indicador de gravação, no espírito do que o Docs e o Planilhas fazem: uma
// nuvem que diz, o tempo todo, se o que está na tela já saiu deste aparelho.
// Ícone e texto juntos de propósito — só o ícone exigiria decorar o desenho.
function StatusDoDrive({ status }) {
  const texto = descreverSincronizacao(status)
  if (!texto) return null

  const nuvem = <path d="M6.5 19a4.5 4.5 0 0 1-.4-8.98 6 6 0 0 1 11.5 1.48A4 4 0 0 1 17.5 19z" />
  return (
    <span className={`notes-status-sync is-${status}`}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {nuvem}
        {status === 'salvo' && <polyline points="9.5,13.5 11.5,15.5 15,11.5" />}
        {status === 'erro' && <line x1="12" y1="10" x2="12" y2="14" />}
        {status === 'erro' && <line x1="12" y1="16.5" x2="12" y2="16.6" />}
      </svg>
      {texto}
    </span>
  )
}

// As abas seguem o padrão de *primary tabs* do MD3: rótulo, e o indicador
// ativo — a barra arredondada colada embaixo da aba selecionada. É ela que
// amarra visualmente a aba ao conteúdo, que é justamente o que faz isso parecer
// aba de navegador. (Antes eram pílulas — pílula no MD3 é chip, que serve
// para filtro e entrada, não para navegar entre coisas abertas.)
//
// Toda anotação é uma aba, sempre — não há mais lista por trás. O "+" no fim
// da barra é o único outro jeito de entrar aqui. Fechar uma aba (✕) é excluir
// a anotação; quem pede a confirmação é o componente pai, que sabe de qual
// nota se trata (o trecho dela entra na pergunta).
function TabBar({ notes, selectedId, onSelect, onRequestDelete, onCreate }) {
  return (
    <div className="notes-toolbar">
      <div className="notes-tabs" role="tablist">
        {notes.map((note) => {
          const ativa = note.id === selectedId
          return (
            <div key={note.id} className={`notes-tab${ativa ? ' is-active' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={ativa}
                className="notes-tab-btn"
                onClick={() => onSelect(note.id)}
              >
                <span className="notes-tab-label">{snippetOf(note)}</span>
              </button>
              <button
                type="button"
                className="notes-tab-close"
                aria-label={`Excluir ${snippetOf(note)}`}
                onClick={() => onRequestDelete(note.id)}
              >
                ✕
              </button>
              <span className="notes-tab-indicador" aria-hidden="true" />
            </div>
          )
        })}
      </div>
      <button type="button" className="notes-tab-add" onClick={onCreate} aria-label="Nova anotação" title="Nova anotação">
        +
      </button>
    </div>
  )
}

// Pergunta em linguagem natural sobre o conjunto de anotações, não sobre a
// aba aberta — por isso mora acima das abas, e não dentro do editor. Os
// resultados aparecem como botões de lista, não chips: clicar num deles
// navega para a anotação, e chip no MD3 é para filtro/entrada/sugestão, não
// para navegar (o mesmo motivo por trás das abas de Notes.jsx serem abas).
function NoteSearch({ onSearch, searching, result, error, onDismiss, onOpenNote }) {
  const [query, setQuery] = useState('')

  function submit(e) {
    e.preventDefault()
    const q = query.trim()
    if (!q || searching) return
    onSearch(q)
  }

  return (
    <div className="notes-search">
      <form onSubmit={submit} className="notes-search-form">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Perguntar sobre as anotações..."
        />
        <button type="submit" disabled={searching || !query.trim()}>
          {searching ? 'Buscando...' : 'Perguntar'}
        </button>
      </form>

      {error && (
        <Banner tone="warning" actionLabel="✕" onAction={onDismiss}>
          {error}
        </Banner>
      )}

      {result && (
        <div className="notes-search-result">
          <div style={{ fontSize: 'var(--body-sm)' }}>{result.answer}</div>
          {result.notas.length > 0 && (
            <div className="notes-search-hits">
              {result.notas.map((n) => (
                <button key={n.id} type="button" className="notes-search-hit" onClick={() => onOpenNote(n.id)}>
                  {n.title?.trim() || '(sem título)'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// O estado de verdade (as anotações, qual está selecionada, a sincronização
// com o Drive, a análise por IA) mora em useNotes — este componente só existe
// enquanto o painel do trilho está aberto.
export default function Notes({ notesState, calendars = [], taskLists = [], onCreateEvent, onCreateTask }) {
  const {
    notes,
    selectedId,
    setSelectedId,
    loading,
    syncStatus,
    error,
    dismissError,
    aiError,
    dismissAiError,
    createNote,
    updateNote,
    deleteNote,
    analyzeNote,
    analyzingIds,
    searchInNotes,
    searching,
    searchResult,
    searchError,
    dismissSearch,
  } = notesState
  const selected = notes.find((n) => n.id === selectedId)
  // A confirmação mora aqui, e não na aba: é aqui que dá para saber qual
  // anotação está prestes a sumir e mostrar o trecho dela na pergunta.
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const pendingDelete = notes.find((n) => n.id === pendingDeleteId)

  return (
    <div>
      {/* Ver APENAS_AGENTE_ATIVO em aiCooldown.js — teste de limite de cota em
          andamento, só o agente deve chamar o Gemini por enquanto. */}
      {notes.length > 0 && !APENAS_AGENTE_ATIVO && (
        <NoteSearch
          onSearch={searchInNotes}
          searching={searching}
          result={searchResult}
          error={searchError}
          onDismiss={dismissSearch}
          onOpenNote={setSelectedId}
        />
      )}

      <TabBar
        notes={notes}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onRequestDelete={setPendingDeleteId}
        onCreate={createNote}
      />

      {error && (
        <Banner tone="warning" actionLabel="✕" onAction={dismissError}>
          {error}
        </Banner>
      )}

      {aiError && (
        <Banner tone="warning" actionLabel="✕" onAction={dismissAiError}>
          {aiError}
        </Banner>
      )}

      {selected ? (
        <NoteEditor
          note={selected}
          onChange={(patch) => updateNote(selected.id, patch)}
          onAnalyze={analyzeNote}
          analyzing={analyzingIds.has(selected.id)}
          syncStatus={syncStatus}
          calendars={calendars}
          taskLists={taskLists}
          onCreateEvent={onCreateEvent}
          onCreateTask={onCreateTask}
          onSelectRelated={setSelectedId}
        />
      ) : (
        <div className="muted" style={{ marginTop: 10 }}>
          {loading ? 'Carregando...' : 'Nada por aqui ainda. Toque em "+" para começar.'}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Excluir anotação"
          message={`Excluir "${snippetOf(pendingDelete)}"? Isso vale para todos os seus aparelhos.`}
          confirmLabel="Excluir"
          danger
          onConfirm={() => {
            deleteNote(pendingDeleteId)
            setPendingDeleteId(null)
          }}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
    </div>
  )
}
