import { useEffect, useRef, useState } from 'react'
import { loadNotes, saveNotes, faltaPermissaoDoDrive, driveApiDesativada, motivoDoGoogle } from './driveNotes.js'
import { permissaoDoDriveConcedida } from './googleAuth.js'
import { mesclarAnotacoes, mesclarApagadas, precisaSubir } from './notesMerge.js'
import { analyzeNoteWithAI } from './aiAnalyzeNote.js'
import { searchNotes } from './aiSearchNotes.js'
import { iaEmPausa } from './aiCooldown.js'

// Falta de permissão não é falha de rede: insistir não resolve, e dizer
// "não deu agora" manda a pessoa esperar por algo que nunca vai acontecer
// sozinho. O caminho de saída precisa estar na própria mensagem.
const MSG_SEM_PERMISSAO =
  'Esta sessão não tem a permissão do Drive (ela chegou depois, e a autorização antiga não a inclui). Toque em "Sair" e entre de novo, marcando a permissão do Google Drive na tela do Google — o que está neste aparelho não se perde.'

const MSG_API_DESATIVADA =
  'A API do Google Drive não está ativada no projeto do Google Cloud deste app. Ative "Google Drive API" no console (console.cloud.google.com → APIs e serviços → Ativar APIs) — Calendar e Tasks funcionarem não ativa o Drive junto, e nenhum login novo resolve isto.'

// Falhar sem dizer por quê foi o que fez este problema demorar a ser
// entendido: a tela dizia "não deu agora" tanto para rede instável quanto
// para causas que nunca iam se resolver sozinhas. O motivo real entra na
// mensagem — e quando não houver um motivo conhecido, entra o que o próprio
// Google escreveu, para o próximo diagnóstico não recomeçar do zero.
function descreverFalha(err, prefixo) {
  if (driveApiDesativada(err)) return MSG_API_DESATIVADA
  if (faltaPermissaoDoDrive(err) || permissaoDoDriveConcedida() === false) return MSG_SEM_PERMISSAO
  const motivo = motivoDoGoogle(err)
  const detalhe = err?.status ? ` (erro ${err.status}${motivo ? `: ${motivo.slice(0, 120)}` : ''})` : ''
  return `${prefixo} — não deu para sincronizar agora${detalhe}.`
}

// Cache local: o que garante que a tela mostra algo na hora, antes do Drive
// responder, e que continua mostrando algo se a rede cair no meio do
// caminho. O Drive é que manda de verdade — este cache existe só para não
// deixar a tela vazia enquanto ele não chega.
const CACHE_KEY = 'gestao-agenda:anotacoes-cache'
const SAVE_DEBOUNCE_MS = 1000

// Mesmo limite usado no editor (Notes.jsx) para decidir se uma anotação é
// curta demais para valer uma chamada de IA — exportado daqui para não
// duplicar o número nos dois lugares.
export const AI_MIN_LENGTH = 10

// O que o rodapé do editor diz sobre a gravação. Antes era uma frase fixa
// ("Sincronizado com o Drive"), que afirmava sucesso mesmo quando nada tinha
// subido — depois de quatro rodadas de conserto na sincronização, é
// exatamente esse tipo de afirmação que não dá para confiar.
//
// 'ocioso' devolve vazio de propósito: antes do primeiro contato com o Drive
// não há o que afirmar, e inventar "salvo" aí seria o erro de novo.
export function descreverSincronizacao(status) {
  if (status === 'salvando') return 'Salvando...'
  if (status === 'salvo') return 'Salvo no Drive'
  if (status === 'erro') return 'Salvo só neste aparelho'
  return ''
}

// Não há infraestrutura de push/cron neste app: a varredura "4x por dia" só
// pode ser uma aproximação que roda enquanto o app está aberto, verificando
// se algum desses horários já passou desde a última vez que rodou.
const SWEEP_HOURS = [8, 10, 13, 15]
const SWEEP_KEY = 'gestao-agenda:anotacoes-sweep-ultima'
// Teto de anotações analisadas por varredura. O que passar disso espera o
// próximo horário — são 4 por dia, então a fila anda.
const MAX_POR_VARREDURA = 5

// O horário do próprio dia que já passou, mais recente — ou, antes das 8h,
// o último horário de ontem. É contra esse instante que se decide se a
// varredura de agora já foi feita ou ainda está pendente.
export function ultimoHorarioDaVarredura(agora) {
  for (const h of [...SWEEP_HOURS].reverse()) {
    const slot = new Date(agora)
    slot.setHours(h, 0, 0, 0)
    if (slot <= agora) return slot
  }
  const slot = new Date(agora)
  slot.setDate(slot.getDate() - 1)
  slot.setHours(SWEEP_HOURS[SWEEP_HOURS.length - 1], 0, 0, 0)
  return slot
}

// O cache nasceu como uma lista crua de anotações e passou a guardar também
// os rastros de exclusão. Quem já tem a versão antiga gravada não pode perder
// nada por causa da troca de formato — daí a leitura aceitar as duas.
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) return { notes: parsed, deleted: [] }
    return {
      notes: Array.isArray(parsed?.notes) ? parsed.notes : [],
      deleted: Array.isArray(parsed?.deleted) ? parsed.deleted : [],
    }
  } catch {
    return { notes: [], deleted: [] }
  }
}

function writeCache(notes, deleted) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ notes, deleted }))
  } catch {
    // Sem espaço ou sem permissão: a nota continua na tela, só não persiste
    // aqui — o Drive ainda é tentado normalmente.
  }
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `nota-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function newNote() {
  const now = new Date().toISOString()
  return { id: makeId(), title: '', body: '', createdAt: now, updatedAt: now }
}

// Resolve a referência curta que o Worker devolveu ("n1", "n2"...) contra a
// mesma lista de outras anotações que foi mandada no pedido de análise —
// mesmo esquema de referência do agente (ver resolverRef em
// agentActions.js). Devolve null quando a referência não bate com nada da
// lista, em vez de aceitar de olhos fechados o que o modelo mandou de volta.
export function resolverNotaRelacionada(ref, outras) {
  if (typeof ref !== 'string' || !ref.startsWith('n')) return null
  const indice = Number(ref.slice(1)) - 1
  const nota = Number.isInteger(indice) && indice >= 0 ? outras[indice] : null
  return nota ? { id: nota.id, title: nota.title } : null
}

// Estado das anotações mora aqui, e não dentro do painel — do mesmo jeito
// que o pomodoro mora em useFocusTimer: o painel só é montado quando o
// trilho abre, mas as anotações (e, mais adiante, a varredura da IA)
// precisam continuar existindo com o painel fechado.
export default function useNotes({ signedIn }) {
  const [notes, setNotes] = useState(() => readCache().notes)
  // Os rastros de exclusão nunca aparecem na tela — só existem para a
  // mesclagem saber o que sumiu de propósito. Um ref basta, e evita um
  // re-render por exclusão.
  const deletedRef = useRef(readCache().deleted)
  // Toda anotação é uma aba, sempre — não há mais lista separada. `selectedId`
  // é qual delas está em primeiro plano. Não persiste entre sessões: reabrir
  // o app volta a escolher (ver o efeito abaixo).
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // 'ocioso' | 'salvando' | 'salvo' | 'erro' — ver descreverSincronizacao.
  const [syncStatus, setSyncStatus] = useState('ocioso')
  // Ids em análise agora — mais de uma nota pode estar sendo analisada ao
  // mesmo tempo (a digitação numa e a varredura programada, por exemplo).
  const [analyzingIds, setAnalyzingIds] = useState(() => new Set())
  // Falha ao pedir sugestões da IA para uma anotação. Separado do `error` de
  // sincronização de propósito — são causas diferentes, e um cobrindo o outro
  // faria a pessoa não saber qual dos dois está acontecendo. Antes disto a
  // falha só ia pro console: o spinner de "analisando" sumia sem sugestão
  // nenhuma, indistinguível de "a IA não achou nada a dizer sobre isto".
  const [aiError, setAiError] = useState(null)
  // Resultado da última pergunta feita sobre as anotações — { answer, notas }
  // ou null antes da primeira busca. Fica fora do estado de uma nota
  // específica porque a pergunta é sobre o conjunto inteiro, não sobre a
  // aba aberta.
  const [searchResult, setSearchResult] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const saveTimer = useRef(null)
  const loadedOnce = useRef(false)
  // "Última versão conhecida" para a varredura programada usar sem precisar
  // recriar os listeners toda vez que as anotações ou a seleção mudam.
  const notesRef = useRef(notes)
  const selectedIdRef = useRef(selectedId)
  const runSweepRef = useRef(() => {})

  useEffect(() => {
    notesRef.current = notes
  }, [notes])

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  // Sem lista para "voltar", sempre precisa haver uma aba em primeiro plano
  // quando existe pelo menos uma anotação — inclusive assim que o Drive traz
  // notas que ainda não existiam no cache local. Se a seleção atual não
  // aponta para nada (começo de sessão, ou a nota selecionada sumiu por outro
  // caminho), a primeira da lista assume.
  useEffect(() => {
    if (selectedId && notes.some((n) => n.id === selectedId)) return
    if (notes.length > 0) setSelectedId(notes[0].id)
  }, [notes, selectedId])

  // Carrega do Drive uma vez por sessão, assim que loga. Enquanto isso não
  // chega, o que já estava no cache local continua na tela.
  useEffect(() => {
    if (!signedIn || loadedOnce.current) return
    loadedOnce.current = true
    // O Google já disse que esta sessão não tem a permissão do Drive: bater
    // nele para tomar 403 só atrasa o aviso que a pessoa precisa ler. As
    // anotações do aparelho continuam na tela normalmente.
    if (permissaoDoDriveConcedida() === false) {
      setError(MSG_SEM_PERMISSAO)
      return
    }
    setLoading(true)
    loadNotes()
      .then((doDrive) => {
        setError(null)
        // `null` é o Drive ainda não ter arquivo nenhum (ou ter vindo
        // ilegível). O que está neste aparelho é a única cópia que existe:
        // ela sobe, e não é substituída por uma lista vazia. Tratar esse
        // caso como "o Drive diz que não há nada" apagaria de vez as
        // anotações de quem escreveu antes de a sincronização funcionar.
        if (doDrive === null) {
          const locais = notesRef.current
          if (locais.length > 0) subirParaODrive(locais)
          else setSyncStatus('salvo')
          return
        }

        // Os dois lados podem ter escrito desde a última conversa — inclusive
        // o mesmo aparelho em dois armazenamentos diferentes (no iOS, o app
        // da tela de início e o Safari são separados). Mesclar, em vez de
        // deixar o Drive sobrescrever, é o que impede um lado de apagar o
        // que o outro escreveu.
        const mescladas = mesclarAnotacoes(notesRef.current, doDrive.notes, doDrive.deleted)
        deletedRef.current = mesclarApagadas(deletedRef.current, doDrive.deleted)
        setNotes(mescladas)
        writeCache(mescladas, deletedRef.current)
        if (precisaSubir(mescladas, doDrive.notes)) {
          subirParaODrive(mescladas)
        } else {
          // Nada a subir: os dois lados já estão iguais, e isso é justamente
          // a informação que faltava na tela.
          setSyncStatus('salvo')
        }
      })
      .catch((err) => {
        console.error('Não foi possível carregar as anotações do Drive:', err)
        setError(descreverFalha(err, 'Mostrando a última versão salva neste aparelho'))
      })
      .finally(() => {
        setLoading(false)
        // Só depois que a lista de verdade chegou do Drive: rodar a varredura
        // em cima do cache velho analisaria anotações desatualizadas.
        runSweepRef.current()
      })
  }, [signedIn])

  // A varredura programada: 4 horários fixos no dia (aproximação client-side,
  // já que o app não tem infraestrutura de push/cron) que revisam com a IA
  // qualquer anotação editada desde a última análise — cobre o caso de a
  // pessoa ter fechado o app antes dos 45s de pausa ou de sair do editor
  // dispararem a análise sozinhos.
  useEffect(() => {
    if (!signedIn) return

    async function sweep() {
      const pendentes = notesRef.current
        .filter((n) => {
          if (n.id === selectedIdRef.current) return false
          if ((n.body || '').trim().length < AI_MIN_LENGTH) return false
          if (!n.lastAnalyzedAt) return true
          return new Date(n.updatedAt) > new Date(n.lastAnalyzedAt)
        })
        // Antes ia a lista inteira de uma vez. Com muitas anotações pendentes
        // isso vira uma rajada de dezenas de chamadas em segundos — o jeito
        // mais rápido de estourar o limite por minuto do Gemini. O que sobrar
        // pega a próxima varredura.
        .slice(0, MAX_POR_VARREDURA)

      for (const nota of pendentes) {
        // Reconfere a cada volta: se a primeira nota já bateu no limite, não
        // adianta insistir com as outras.
        if (iaEmPausa()) return
        await analyzeNote(nota.id, nota.body)
      }
    }

    function checkSweep() {
      if (document.visibilityState !== 'visible') return
      if (iaEmPausa()) return
      const agora = new Date()
      const alvo = ultimoHorarioDaVarredura(agora)
      let ultima = null
      try {
        ultima = localStorage.getItem(SWEEP_KEY)
      } catch {
        // Sem acesso ao localStorage: a varredura roda a cada checagem em vez
        // de uma vez por horário — pior caso é gastar mais chamadas de IA,
        // nunca travar a função.
      }
      if (ultima && new Date(ultima) >= alvo) return
      try {
        localStorage.setItem(SWEEP_KEY, agora.toISOString())
      } catch {
        // Ver comentário acima.
      }
      sweep()
    }

    runSweepRef.current = checkSweep
    document.addEventListener('visibilitychange', checkSweep)
    window.addEventListener('focus', checkSweep)
    const id = setInterval(checkSweep, 5 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', checkSweep)
      window.removeEventListener('focus', checkSweep)
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  function persist(next) {
    setNotes(next)
    writeCache(next, deletedRef.current)
    // Há alteração não gravada a partir daqui, e é isso que o status diz —
    // mesmo durante o segundo de espera do debounce.
    setSyncStatus('salvando')
    // Uma gravação por pausa na digitação, não uma por tecla — sem isso,
    // toda letra digitada viraria uma chamada ao Drive.
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      subirParaODrive(next)
    }, SAVE_DEBOUNCE_MS)
  }

  // Todo caminho que grava no Drive passa por aqui, para o status na tela
  // nunca discordar do que de fato aconteceu. Antes o sucesso não avisava
  // nada: só dava para saber que a sincronização funcionava quando ela
  // falhava, e o rodapé afirmava "Sincronizado com o Drive" de qualquer jeito.
  async function subirParaODrive(lista) {
    setSyncStatus('salvando')
    try {
      await saveNotes(lista, deletedRef.current)
      setSyncStatus('salvo')
      // Uma gravação que deu certo desmente um aviso antigo de falha.
      setError(null)
    } catch (err) {
      setSyncStatus('erro')
      relatarFalhaAoSincronizar(err)
    }
  }

  function relatarFalhaAoSincronizar(err) {
    console.error('Não foi possível sincronizar as anotações com o Drive:', err)
    setError(descreverFalha(err, 'A última alteração ficou salva só neste aparelho'))
  }

  function createNote() {
    const note = newNote()
    persist([note, ...notes])
    setSelectedId(note.id)
    return note
  }

  // `touch: false` é para atualização que a própria IA faz (título sugerido,
  // sugestões novas): isso não é "o usuário editou agora", e bumped
  // `updatedAt` faria a nota pular para o topo da lista sozinha, sem
  // nenhuma edição de verdade por trás.
  function updateNote(id, patch, { touch = true } = {}) {
    persist(
      notes.map((n) => (n.id === id ? { ...n, ...patch, ...(touch ? { updatedAt: new Date().toISOString() } : {}) } : n))
    )
  }

  // A exclusão precisa deixar rastro: é só por ele que o outro aparelho
  // distingue "esta anotação foi apagada" de "esta anotação ainda não subiu"
  // — sem isso, a mesclagem devolveria para a tela tudo que foi apagado.
  //
  // Fechar a aba É excluir agora (a confirmação mora no componente): se era a
  // aba em primeiro plano, quem assume é a vizinha (a anterior, ou a próxima
  // se era a primeira) — nunca aparece uma tela vazia por ter fechado a aba
  // ativa enquanto sobram outras.
  function deleteNote(id) {
    deletedRef.current = mesclarApagadas(
      [...deletedRef.current.filter((d) => d.id !== id), { id, at: new Date().toISOString() }],
      []
    )
    const i = notes.findIndex((n) => n.id === id)
    const restante = notes.filter((n) => n.id !== id)
    persist(restante)
    setSelectedId((atual) => {
      if (atual !== id) return atual
      if (restante.length === 0) return null
      return restante[Math.min(i, restante.length - 1)].id
    })
  }

  // Chamada com o texto atual em mãos (não lido de volta do estado), porque
  // quem chama pode estar prestes a navegar para fora do editor antes da
  // gravação debounced da digitação ter tido tempo de acontecer.
  async function analyzeNote(id, bodyText) {
    const text = (bodyText ?? '').trim()
    if (!text) return
    setAnalyzingIds((prev) => new Set(prev).add(id))
    try {
      // Nunca a nota inteira das outras — só título e um trecho curto, o
      // bastante para o modelo notar uma relação sem custar uma chamada cara.
      const outras = notes.filter((n) => n.id !== id)
      const { title, suggestions, notaRelacionadaRef } = await analyzeNoteWithAI(text, { notas: outras })
      const note = notes.find((n) => n.id === id)
      const patch = {
        suggestions,
        lastAnalyzedAt: new Date().toISOString(),
        relatedNote: resolverNotaRelacionada(notaRelacionadaRef, outras),
      }
      // Só substitui o título se o usuário não tiver escrito um por conta
      // própria — a IA sugere, não sobrescreve o que já foi decidido.
      if (title && !note?.title?.trim()) patch.title = title
      updateNote(id, patch, { touch: false })
    } catch (err) {
      // A nota continua normal, só sem sugestões novas — uma anotação não
      // pode travar por causa da IA estar fora do ar. Mas a pessoa precisa
      // saber que foi isso, e não que não havia nada a sugerir.
      console.error('Não foi possível analisar a anotação:', err)
      setAiError(
        err.transiente
          ? 'A IA está sobrecarregada ou sem cota por agora — as sugestões voltam sozinhas mais tarde.'
          : `Não deu para revisar essa anotação com a IA agora (${err.message}).`
      )
    } finally {
      setAnalyzingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  // Pergunta em linguagem natural sobre o conjunto de anotações ("o que eu
  // escrevi sobre o caso da Maria?"). Guarda a lista de notas na mesma ordem
  // mandada ao Worker — é contra ela que as referências que voltam (n1, n2...)
  // são resolvidas de volta para a nota real.
  async function searchInNotes(query) {
    const q = (query ?? '').trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    try {
      const { answer, refs } = await searchNotes(q, notes)
      const encontradas = refs.map((ref) => resolverNotaRelacionada(ref, notes)).filter(Boolean)
      setSearchResult({ answer, notas: encontradas })
    } catch (err) {
      console.error('Não foi possível buscar nas anotações:', err)
      setSearchError(
        err.transiente
          ? 'A IA está sobrecarregada ou sem cota por agora — tenta de novo daqui a pouco.'
          : `Não deu para buscar agora (${err.message}).`
      )
    } finally {
      setSearching(false)
    }
  }

  return {
    notes,
    selectedId,
    setSelectedId,
    loading,
    syncStatus,
    error,
    dismissError: () => setError(null),
    aiError,
    dismissAiError: () => setAiError(null),
    createNote,
    updateNote,
    deleteNote,
    analyzeNote,
    analyzingIds,
    searchInNotes,
    searching,
    searchResult,
    searchError,
    dismissSearch: () => setSearchResult(null),
  }
}
