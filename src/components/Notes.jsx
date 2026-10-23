import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'
import Banner from './Banner.jsx'
import SuggestionCard from './SuggestionCard.jsx'
import { AI_MIN_LENGTH, descreverSincronizacao } from '../lib/useNotes.js'
import { IA_DESLIGADA } from '../lib/aiCooldown.js'
import { organizarNotas, tituloDaNota, previaDaNota, dataCurta, dataPorExtenso, notaVazia } from '../lib/notasLista.js'

// Tempo parado depois da última tecla para considerar que a anotação foi
// "finalizada" e vale a pena gastar uma chamada de IA nela. Bem mais longo
// que o do QuickAdd: aqui o texto é livre e pode crescer por minutos antes
// de a pessoa realmente terminar o pensamento.
const AI_IDLE_MS = 45000

// Título e corpo ficam com estado próprio aqui dentro, sincronizado com a
// nota selecionada só depois de uma pausa na digitação — o mesmo motivo de
// sempre: gravar a cada tecla gastaria uma chamada ao Drive por letra. A IA
// tem seu próprio timer, bem mais longo (ver AI_IDLE_MS): a ideia é analisar
// quando a anotação estiver "pronta", não a cada pausa curta de digitação.
function NoteEditor({ note, projetos = [], onProjetoChange, onChange, onAnalyze, analyzing, syncStatus, calendars, taskLists, onCreateEvent, onCreateTask, onSelectRelated, onVoltar, onAlternarFixada, onExcluir }) {
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

    // Ver IA_DESLIGADA em aiCooldown.js: a chave geral da IA está desligada,
    // e as anotações funcionam sem ela.
    if (!IA_DESLIGADA) {
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
  const corpoRef = useRef(null)

  // O texto cresce com o conteúdo, como no Notas, em vez de uma caixa de
  // altura fixa com rolagem dentro da rolagem do painel.
  useEffect(() => {
    const el = corpoRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [body])

  // Voltar leva junto o que ainda está no debounce: sem isso, a última frase
  // digitada antes de tocar em "Anotações" se perdia.
  function voltar() {
    clearTimeout(saveTimer.current)
    if (title !== note.title || body !== note.body) onChange({ title, body })
    onVoltar({ title, body })
  }

  return (
    <div className="nota-editor">
      <div className="nota-barra">
        <button type="button" className="nota-voltar" onClick={voltar}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Anotações
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className={`icon-btn${note.fixada ? ' icon-btn--live' : ''}`}
          onClick={onAlternarFixada}
          aria-pressed={Boolean(note.fixada)}
          aria-label={note.fixada ? 'Desafixar' : 'Fixar no topo'}
          title={note.fixada ? 'Desafixar' : 'Fixar no topo'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={note.fixada ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 4h6l-1 6 3 3H7l3-3z" />
            <line x1="12" y1="13" x2="12" y2="20" />
          </svg>
        </button>
        <button type="button" className="icon-btn" onClick={() => window.print()} aria-label="Imprimir" title="Imprimir">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 6 3 18 3 18 9" />
            <rect x="4" y="9" width="16" height="8" rx="2" />
            <rect x="7" y="14" width="10" height="7" />
          </svg>
        </button>
        <button type="button" className="icon-btn" onClick={onExcluir} aria-label="Excluir anotação" title="Excluir anotação">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="4 7 20 7" />
            <path d="M6 7l1 13h10l1-13" />
            <path d="M9 7V4h6v3" />
          </svg>
        </button>
      </div>

      <div className="nota-carimbo">{dataPorExtenso(note.updatedAt)}</div>

      <input
        type="text"
        className="nota-titulo"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título"
        aria-label="Título"
      />

      {/* A anotação de um caso mora no projeto dele — é assim que ela aparece
          na página do projeto, junto das tarefas e compromissos. */}
      {(projetos.length > 0 || note.projeto) && (
        <label className="note-projeto">
          <span>Projeto</span>
          <select value={note.projeto || ''} onChange={(e) => onProjetoChange(e.target.value)}>
            <option value="">Nenhum</option>
            {note.projeto && !projetos.some((p) => p.id === note.projeto) && (
              <option value={note.projeto}>{note.projeto}</option>
            )}
            {projetos.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </select>
        </label>
      )}

      <textarea
        ref={corpoRef}
        className="nota-corpo"
        // Só a nota recém-criada abre com o teclado: abrir uma existente
        // para ler não deveria jogar o teclado por cima do texto.
        autoFocus={notaVazia(note)}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Escreva aqui..."
        aria-label="Texto da anotação"
      />

      <div className="notes-status">
        <StatusDoDrive status={syncStatus} />
        {analyzing && <span>· revisando com a IA...</span>}
      </div>

      {/* Só isto fica visível na hora de imprimir (ver @media print em
          index.css) — título e input/textarea têm bordas, placeholder e
          podem cortar texto que não cabe na altura visível deles. */}
      <div className="notes-print-only" aria-hidden="true">
        <h1>{tituloDaNota({ title, body })}</h1>
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
    </div>
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

// A lista do Notas do iPhone, nas peças do MD3: campo de busca, seções com
// cabeçalho (Fixadas, Hoje, Ontem...), linhas de lista de duas linhas e o FAB
// para a ação principal da tela, que aqui é escrever uma anotação nova.
function ListaDeNotas({ notes, loading, onAbrir, onCriar }) {
  const [busca, setBusca] = useState('')
  const agora = new Date()
  const secoes = organizarNotas(notes, agora, busca)

  return (
    <div className="notas-lista">
      {notes.length > 0 && (
        <label className="notas-busca">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar" aria-label="Buscar nas anotações" />
        </label>
      )}

      {secoes.map((secao) => (
        <section key={secao.titulo} className="notas-secao">
          <h3>{secao.titulo}</h3>
          <ul>
            {secao.notas.map((nota) => (
              <li key={nota.id}>
                <button type="button" className="notas-linha" onClick={() => onAbrir(nota.id)}>
                  <span className="notas-linha-titulo">{tituloDaNota(nota)}</span>
                  <span className="notas-linha-sub">
                    <span className="notas-linha-data">{dataCurta(nota.updatedAt, agora)}</span>
                    <span className="notas-linha-previa">{previaDaNota(nota)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {notes.length === 0 && (
        <div className="muted notas-vazio">{loading ? 'Carregando...' : 'Nenhuma anotação ainda.'}</div>
      )}
      {notes.length > 0 && secoes.length === 0 && <div className="muted notas-vazio">Nada encontrado para "{busca}".</div>}
      {notes.length > 0 && (
        <div className="notas-contagem">{notes.length === 1 ? '1 anotação' : `${notes.length} anotações`}</div>
      )}

      <button type="button" className="fab notas-fab" onClick={onCriar} aria-label="Nova anotação" title="Nova anotação">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      </button>
    </div>
  )
}

// Pergunta em linguagem natural sobre o conjunto de anotações, não sobre a
// anotação aberta — por isso mora na lista, e não dentro do editor. Os
// resultados aparecem como botões de lista, não chips: clicar num deles
// navega para a anotação, e chip no MD3 é para filtro/entrada/sugestão, não
// para navegar.
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
export default function Notes({ notesState, projetos = [], calendars = [], taskLists = [], onCreateEvent, onCreateTask }) {
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
  // A confirmação mora aqui: é aqui que dá para saber qual anotação está
  // prestes a sumir e mostrar o título dela na pergunta.
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const pendingDelete = notes.find((n) => n.id === pendingDeleteId)

  // Voltar de uma anotação que ficou em branco a descarta, como no Notas —
  // tocar no "+" e desistir não pode deixar uma "Nova anotação" vazia na lista.
  function voltar(id, atual) {
    if (notaVazia(atual)) deleteNote(id)
    else setSelectedId(null)
  }

  const banners = (
    <>
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
    </>
  )

  return (
    <div className="notas">
      {selected ? (
        <>
          {banners}
          <NoteEditor
            note={selected}
            projetos={projetos}
            // `undefined` apaga o campo: sanitizeNote não grava projeto vazio.
            onProjetoChange={(projeto) => updateNote(selected.id, { projeto: projeto || undefined })}
            onChange={(patch) => updateNote(selected.id, patch)}
            onAnalyze={analyzeNote}
            analyzing={analyzingIds.has(selected.id)}
            syncStatus={syncStatus}
            calendars={calendars}
            taskLists={taskLists}
            onCreateEvent={onCreateEvent}
            onCreateTask={onCreateTask}
            onSelectRelated={setSelectedId}
            onVoltar={(atual) => voltar(selected.id, atual)}
            onAlternarFixada={() => updateNote(selected.id, { fixada: selected.fixada ? undefined : true })}
            onExcluir={() => setPendingDeleteId(selected.id)}
          />
        </>
      ) : (
        <>
          {/* Ver IA_DESLIGADA em aiCooldown.js: com a IA desligada esta busca
              não aparece — a busca da lista continua valendo. */}
          {notes.length > 0 && !IA_DESLIGADA && (
            <NoteSearch
              onSearch={searchInNotes}
              searching={searching}
              result={searchResult}
              error={searchError}
              onDismiss={dismissSearch}
              onOpenNote={setSelectedId}
            />
          )}
          {banners}
          <ListaDeNotas notes={notes} loading={loading} onAbrir={setSelectedId} onCriar={() => createNote()} />
        </>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Excluir anotação"
          message={`Excluir "${tituloDaNota(pendingDelete)}"? Isso vale para todos os seus aparelhos.`}
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
