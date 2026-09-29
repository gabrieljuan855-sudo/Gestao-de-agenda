import { useEffect, useRef, useState } from 'react'
import { loadProjetos, saveProjetos } from './driveNotes.js'
import { permissaoDoDriveConcedida } from './googleAuth.js'
import { mesclarAnotacoes, precisaSubir } from './notesMerge.js'
import { normalizarProjeto, normalizarProjetos } from './projetos.js'
import { descreverFalha, MSG_SEM_PERMISSAO } from './useNotes.js'

// As fichas dos projetos seguem o mesmo caminho das anotações — cache neste
// aparelho para a tela nunca nascer vazia, Drive como fonte de verdade entre
// aparelhos — mas num arquivo separado (projetos.json). Juntar no mesmo
// arquivo das anotações faria um formato quebrado num lado derrubar o outro.
const CACHE_KEY = 'gestao-agenda:projetos-cache'
const SAVE_DEBOUNCE_MS = 1000

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return normalizarProjetos(raw ? JSON.parse(raw) : [])
  } catch {
    return []
  }
}

function writeCache(projetos) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(projetos))
  } catch {
    // Sem espaço: a ficha continua na tela e o Drive ainda é tentado.
  }
}

export default function useProjetos({ signedIn }) {
  const [projetos, setProjetos] = useState(readCache)
  const [error, setError] = useState(null)
  const [syncStatus, setSyncStatus] = useState('ocioso')
  const projetosRef = useRef(projetos)
  const loadedOnce = useRef(false)
  const saveTimer = useRef(null)

  useEffect(() => {
    projetosRef.current = projetos
  }, [projetos])

  useEffect(() => {
    if (!signedIn || loadedOnce.current) return
    loadedOnce.current = true
    if (permissaoDoDriveConcedida() === false) {
      setError(MSG_SEM_PERMISSAO)
      return
    }
    loadProjetos()
      .then((doDrive) => {
        setError(null)
        if (doDrive === null) {
          // Ainda não existe arquivo de projetos no Drive: o que há aqui é a
          // única cópia, então sobe (nunca é trocado por lista vazia).
          if (projetosRef.current.length > 0) subir(projetosRef.current)
          else setSyncStatus('salvo')
          return
        }
        // Exclusão de ficha não existe (concluir é o fim de um projeto), então
        // a mesclagem por id e última edição basta, sem rastro de apagadas.
        const remotos = normalizarProjetos(doDrive)
        const mesclados = mesclarAnotacoes(projetosRef.current, remotos, [])
        setProjetos(mesclados)
        writeCache(mesclados)
        if (precisaSubir(mesclados, remotos)) subir(mesclados)
        else setSyncStatus('salvo')
      })
      .catch((err) => {
        console.error('Não foi possível carregar os projetos do Drive:', err)
        setError(descreverFalha(err, 'Mostrando os projetos salvos neste aparelho'))
      })
  }, [signedIn])

  async function subir(lista) {
    setSyncStatus('salvando')
    try {
      await saveProjetos(normalizarProjetos(lista))
      setSyncStatus('salvo')
      setError(null)
    } catch (err) {
      console.error('Não foi possível sincronizar os projetos com o Drive:', err)
      setSyncStatus('erro')
      setError(descreverFalha(err, 'A última alteração ficou salva só neste aparelho'))
    }
  }

  function persist(next) {
    setProjetos(next)
    projetosRef.current = next
    writeCache(next)
    setSyncStatus('salvando')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => subir(next), SAVE_DEBOUNCE_MS)
  }

  // Cria ou atualiza a ficha (o id é a etiqueta, então "salvar" um projeto
  // que só existia como etiqueta solta é o que dá ficha a ele).
  function salvarProjeto(dados) {
    const agora = new Date()
    const atual = projetosRef.current.find((p) => p.id === dados.id)
    const ficha = normalizarProjeto(
      { ...atual, ...dados, createdAt: atual?.createdAt || agora.toISOString(), updatedAt: agora.toISOString() },
      agora
    )
    if (!ficha) return null
    persist(atual ? projetosRef.current.map((p) => (p.id === ficha.id ? ficha : p)) : [ficha, ...projetosRef.current])
    return ficha
  }

  return {
    projetos,
    salvarProjeto,
    syncStatus,
    error,
    dismissError: () => setError(null),
  }
}
