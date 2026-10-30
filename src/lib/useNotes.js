import { useEffect, useRef, useState } from 'react'
import { loadNotes, saveNotes, faltaPermissaoDoDrive, driveApiDesativada, motivoDoGoogle } from './driveNotes.js'
import { permissaoDoDriveConcedida } from './googleAuth.js'
import { mesclarAnotacoes, mesclarApagadas, mesclarParaGravar, precisaSubir } from './notesMerge.js'
import { analyzeNoteWithAI } from './aiAnalyzeNote.js'
import { searchNotes } from './aiSearchNotes.js'
import { newNote, textoOuVazio, sanitizeNotes } from './notasFormato.js'
import { renomearLinks } from './notasLinks.js'

// Continuam sendo importados daqui pelo resto do app e pelos testes.
export { sanitizeNote, sanitizeNotes } from './notasFormato.js'

// Falta de permissão não é falha de rede: insistir não resolve, e dizer
// "não deu agora" manda a pessoa esperar por algo que nunca vai acontecer
// sozinho. O caminho de saída precisa estar na própria mensagem.
export const MSG_SEM_PERMISSAO =
  'Esta sessão não tem a permissão do Drive (ela chegou depois, e a autorização antiga não a inclui). Toque em "Sair" e entre de novo, marcando a permissão do Google Drive na tela do Google — o que está neste aparelho não se perde.'

const MSG_API_DESATIVADA =
  'A API do Google Drive não está ativada no projeto do Google Cloud deste app. Ative "Google Drive API" no console (console.cloud.google.com → APIs e serviços → Ativar APIs) — Calendar e Tasks funcionarem não ativa o Drive junto, e nenhum login novo resolve isto.'

// Falhar sem dizer por quê foi o que fez este problema demorar a ser
// entendido: a tela dizia "não deu agora" tanto para rede instável quanto
// para causas que nunca iam se resolver sozinhas. O motivo real entra na
// mensagem — e quando não houver um motivo conhecido, entra o que o próprio
// Google escreveu, para o próximo diagnóstico não recomeçar do zero.
export function descreverFalha(err, prefixo) {
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

// O cache nasceu como uma lista crua de anotações e passou a guardar também
// os rastros de exclusão. Quem já tem a versão antiga gravada não pode perder
// nada por causa da troca de formato — daí a leitura aceitar as duas.
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) return { notes: sanitizeNotes(parsed), deleted: [] }
    return {
      notes: sanitizeNotes(parsed?.notes),
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

// Resolve a referência curta que o Worker devolveu ("n1", "n2"...) contra a
// mesma lista de outras anotações que foi mandada no pedido de análise.
// Devolve null quando a referência não bate com nada da lista, em vez de
// aceitar de olhos fechados o que o modelo mandou de volta — o id real nunca
// é pedido ao modelo, justamente para um caractere trocado não virar a
// anotação errada aberta na tela.
export function resolverNotaRelacionada(ref, outras) {
  if (typeof ref !== 'string' || !ref.startsWith('n')) return null
  const indice = Number(ref.slice(1)) - 1
  const nota = Number.isInteger(indice) && indice >= 0 ? outras[indice] : null
  return nota ? { id: nota.id, title: nota.title } : null
}

// Estado das anotações mora aqui, e não dentro do painel — do mesmo jeito
// que o pomodoro mora em useFocusTimer: o painel só é montado quando o
// trilho abre, mas as anotações precisam continuar existindo com o painel
// fechado.
export default function useNotes({ signedIn }) {
  const [notes, setNotes] = useState(() => readCache().notes)
  // Os rastros de exclusão nunca aparecem na tela — só existem para a
  // mesclagem saber o que sumiu de propósito. Um ref basta, e evita um
  // re-render por exclusão.
  const deletedRef = useRef(readCache().deleted)
  // A anotação aberta no editor; null é a lista. Quem abre uma de fora (a
  // página do projeto, a Entrada) só precisa apontar para ela aqui.
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // 'ocioso' | 'salvando' | 'salvo' | 'erro' — ver descreverSincronizacao.
  const [syncStatus, setSyncStatus] = useState('ocioso')
  // Ids em análise agora — mais de uma nota pode estar sendo analisada ao
  // mesmo tempo se a pessoa alternar de aba enquanto uma análise ainda roda.
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
  const notesRef = useRef(notes)

  useEffect(() => {
    notesRef.current = notes
  }, [notes])

  // A anotação aberta pode sumir por outro caminho (apagada no outro
  // aparelho e trazida pela sincronização): aí volta para a lista, em vez de
  // um editor apontando para nada.
  useEffect(() => {
    if (selectedId && !notes.some((n) => n.id === selectedId)) setSelectedId(null)
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
          if (locais.length > 0) subirParaODrive()
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
        notesRef.current = mescladas
        writeCache(mescladas, deletedRef.current)
        if (precisaSubir(mescladas, doDrive.notes)) {
          subirParaODrive()
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
      .finally(() => setLoading(false))
  }, [signedIn])

  function persist(next) {
    setNotes(next)
    // Atualizado aqui, e não só no efeito pós-render: duas edições no mesmo
    // instante (a gravação atrasada da digitação e a troca de projeto da
    // nota) precisam enxergar uma a outra, senão a segunda desfaz a primeira.
    notesRef.current = next
    writeCache(next, deletedRef.current)
    // Há alteração não gravada a partir daqui, e é isso que o status diz —
    // mesmo durante o segundo de espera do debounce.
    setSyncStatus('salvando')
    // Uma gravação por pausa na digitação, não uma por tecla — sem isso,
    // toda letra digitada viraria uma chamada ao Drive.
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      subirParaODrive()
    }, SAVE_DEBOUNCE_MS)
  }

  // Todo caminho que grava no Drive passa por aqui, para o status na tela
  // nunca discordar do que de fato aconteceu. Antes o sucesso não avisava
  // nada: só dava para saber que a sincronização funcionava quando ela
  // falhava, e o rodapé afirmava "Sincronizado com o Drive" de qualquer jeito.
  async function subirParaODrive() {
    setSyncStatus('salvando')
    try {
      // O conector do Claude grava no mesmo arquivo. Subir a lista local por
      // cima, sem reler, apagava a nota que ele tinha acabado de criar — então
      // o Drive entra na conta antes de gravar (ver mesclarParaGravar).
      const doDrive = await loadNotes()
      // A lista local é lida aqui, depois da espera, e não antes: a pessoa pode
      // ter continuado digitando enquanto o Drive respondia, e mesclar uma
      // cópia de antes desfaria essas letras na tela.
      const locais = notesRef.current
      let paraGravar = locais
      if (doDrive) {
        const mescla = mesclarParaGravar(locais, doDrive, deletedRef.current)
        deletedRef.current = mescla.deleted
        paraGravar = mescla.notes
        // O outro lado trouxe algo (uma nota nova, uma edição mais recente):
        // aparece na tela já, em vez de só na próxima abertura.
        if (precisaSubir(paraGravar, locais)) {
          setNotes(paraGravar)
          notesRef.current = paraGravar
          writeCache(paraGravar, deletedRef.current)
        }
      }
      // Última barreira antes do JSON.stringify: mesmo que algo em memória
      // tenha corrompido uma nota (ver sanitizeNote), o que sai para o Drive
      // continua no formato certo.
      await saveNotes(sanitizeNotes(paraGravar), deletedRef.current)
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

  // `inicial` existe para quando a anotação já nasce com conteúdo — é o caso
  // do item da Entrada que a pessoa decide que é só referência, e vira nota
  // em vez de tarefa. Criar vazia e editar logo em seguida não serviria: o
  // updateNote seguinte ainda enxergaria a lista antiga e desfaria a criação.
  function createNote(inicial = {}) {
    // Só título e corpo, nunca o objeto inteiro: ver o comentário de
    // sanitizeNote sobre o que dá errado quando se espalha `inicial` sem
    // filtro (foi assim que um clique virou o dado de uma nota).
    const note = { ...newNote(), title: textoOuVazio(inicial.title), body: textoOuVazio(inicial.body) }
    // A página do projeto cria a anotação já dentro dele.
    if (typeof inicial.projeto === 'string' && inicial.projeto) note.projeto = inicial.projeto
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
      notesRef.current.map((n) =>
        n.id === id ? { ...n, ...patch, ...(touch ? { updatedAt: new Date().toISOString() } : {}) } : n
      )
    )
  }

  // Depois que o título de uma nota muda de vez (a pessoa saiu do campo ou
  // da nota), os [[links]] das outras notas passam a usar o título novo. Não
  // a cada tecla: um título no meio da digitação ("Caso S") poderia coincidir
  // com o de outra nota e levar os links para o lugar errado.
  function renomearLinksDaNota(id, tituloAntigo) {
    const { notas, alteradas } = renomearLinks(notesRef.current, id, tituloAntigo)
    if (alteradas.length) persist(notas)
  }

  // A exclusão precisa deixar rastro: é só por ele que o outro aparelho
  // distingue "esta anotação foi apagada" de "esta anotação ainda não subiu"
  // — sem isso, a mesclagem devolveria para a tela tudo que foi apagado.
  //
  // Excluir a anotação aberta volta para a lista, como no Notas.
  function deleteNote(id) {
    deletedRef.current = mesclarApagadas(
      [...deletedRef.current.filter((d) => d.id !== id), { id, at: new Date().toISOString() }],
      []
    )
    persist(notesRef.current.filter((n) => n.id !== id))
    setSelectedId((atual) => (atual === id ? null : atual))
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
          ? err.message
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
          ? err.message
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
    renomearLinksDaNota,
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
