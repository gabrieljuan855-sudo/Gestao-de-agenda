import { useEffect, useRef, useState } from 'react'
import { loadProjetos, saveProjetos } from './driveNotes.js'
import { permissaoDoDriveConcedida } from './googleAuth.js'
import { mesclarAnotacoes, precisaSubir } from './notesMerge.js'
import { normalizarProjeto, normalizarProjetos, fichaParaEtiqueta } from './projetos.js'
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
  // Já leu o projetos.json do Drive nesta sessão. Antes disso, o que está na
  // tela é só o cache deste aparelho — e "esta etiqueta não tem ficha" pode
  // ser só ficha que outro aparelho criou e ainda não chegou aqui.
  const [carregado, setCarregado] = useState(false)
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
        setCarregado(true)
        if (doDrive === null) {
          // Ainda não existe arquivo de projetos no Drive: o que há aqui é a
          // única cópia, então sobe (nunca é trocado por lista vazia).
          if (projetosRef.current.length > 0) subir()
          else setSyncStatus('salvo')
          return
        }
        // Exclusão de ficha não existe (concluir é o fim de um projeto), então
        // a mesclagem por id e última edição basta, sem rastro de apagadas.
        const remotos = normalizarProjetos(doDrive)
        const mesclados = mesclarAnotacoes(projetosRef.current, remotos, [])
        setProjetos(mesclados)
        projetosRef.current = mesclados
        writeCache(mesclados)
        if (precisaSubir(mesclados, remotos)) subir()
        else setSyncStatus('salvo')
      })
      .catch((err) => {
        console.error('Não foi possível carregar os projetos do Drive:', err)
        setError(descreverFalha(err, 'Mostrando os projetos salvos neste aparelho'))
      })
  }, [signedIn])

  async function subir() {
    setSyncStatus('salvando')
    try {
      // O conector do Claude também cria e edita fichas neste arquivo: o que
      // está no Drive agora entra na conta antes de gravar, para uma ficha
      // criada por ele não sumir na próxima edição feita aqui. Fichas não se
      // excluem (concluir é o fim de um projeto), então não há rastro a somar.
      const doDrive = await loadProjetos()
      const locais = projetosRef.current
      let paraGravar = locais
      if (doDrive !== null) {
        paraGravar = mesclarAnotacoes(locais, normalizarProjetos(doDrive), [])
        if (precisaSubir(paraGravar, locais)) {
          setProjetos(paraGravar)
          projetosRef.current = paraGravar
          writeCache(paraGravar)
        }
      }
      await saveProjetos(normalizarProjetos(paraGravar))
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
    saveTimer.current = setTimeout(() => subir(), SAVE_DEBOUNCE_MS)
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

  // Ficha para cada etiqueta que ainda não tem (ver fichaParaEtiqueta), numa
  // gravação só. Nunca mexe numa ficha que já existe.
  function garantirFichas(ids) {
    const existentes = new Set(projetosRef.current.map((p) => p.id))
    const novas = [...new Set(ids)].filter((id) => !existentes.has(id)).map((id) => fichaParaEtiqueta(id)).filter(Boolean)
    if (novas.length) persist([...novas, ...projetosRef.current])
  }

  return {
    projetos,
    carregado,
    salvarProjeto,
    garantirFichas,
    syncStatus,
    error,
    dismissError: () => setError(null),
  }
}
