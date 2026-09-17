import { useEffect, useRef, useState } from 'react'
import { loadNotes, saveNotes } from './driveNotes.js'

// Cache local: o que garante que a tela mostra algo na hora, antes do Drive
// responder, e que continua mostrando algo se a rede cair no meio do
// caminho. O Drive é que manda de verdade — este cache existe só para não
// deixar a tela vazia enquanto ele não chega.
const CACHE_KEY = 'gestao-agenda:anotacoes-cache'
const SAVE_DEBOUNCE_MS = 1000

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeCache(notes) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(notes))
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

// Estado das anotações mora aqui, e não dentro do painel — do mesmo jeito
// que o pomodoro mora em useFocusTimer: o painel só é montado quando o
// trilho abre, mas as anotações (e, mais adiante, a varredura da IA)
// precisam continuar existindo com o painel fechado.
export default function useNotes({ signedIn }) {
  const [notes, setNotes] = useState(readCache)
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const saveTimer = useRef(null)
  const loadedOnce = useRef(false)

  // Carrega do Drive uma vez por sessão, assim que loga. Enquanto isso não
  // chega, o que já estava no cache local continua na tela.
  useEffect(() => {
    if (!signedIn || loadedOnce.current) return
    loadedOnce.current = true
    setLoading(true)
    loadNotes()
      .then((fromDrive) => {
        setNotes(fromDrive)
        writeCache(fromDrive)
        setError(null)
      })
      .catch((err) => {
        console.error('Não foi possível carregar as anotações do Drive:', err)
        setError('Não deu para buscar suas anotações mais recentes — mostrando a última versão salva neste aparelho.')
      })
      .finally(() => setLoading(false))
  }, [signedIn])

  function persist(next) {
    setNotes(next)
    writeCache(next)
    // Uma gravação por pausa na digitação, não uma por tecla — sem isso,
    // toda letra digitada viraria uma chamada ao Drive.
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveNotes(next).catch((err) => {
        console.error('Não foi possível sincronizar as anotações com o Drive:', err)
        setError('A última alteração ficou salva só neste aparelho — não deu para sincronizar agora.')
      })
    }, SAVE_DEBOUNCE_MS)
  }

  function createNote() {
    const note = newNote()
    persist([note, ...notes])
    setSelectedId(note.id)
    return note
  }

  function updateNote(id, patch) {
    persist(notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n)))
  }

  function deleteNote(id) {
    persist(notes.filter((n) => n.id !== id))
    setSelectedId((current) => (current === id ? null : current))
  }

  return {
    notes,
    selectedId,
    setSelectedId,
    loading,
    error,
    dismissError: () => setError(null),
    createNote,
    updateNote,
    deleteNote,
  }
}
