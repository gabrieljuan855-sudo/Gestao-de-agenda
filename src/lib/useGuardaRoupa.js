import { useEffect, useRef, useState } from 'react'
import { loadGuardaRoupa, saveGuardaRoupa } from './driveNotes.js'
import { enviarArquivoAoDrive, pastaDoGuardaRoupa, mandarParaLixeira } from './googleApi.js'
import { permissaoDoDriveConcedida } from './googleAuth.js'
import { descreverFalha, MSG_SEM_PERMISSAO } from './useNotes.js'
import { reduzirImagem } from './imagemReduzida.js'
import { guardarFoto, esquecerFoto } from './fotosDoDrive.js'
import {
  normalizarGuardaRoupa,
  mesclarGuardaRoupa,
  difere,
  novaPeca,
  editarPeca,
  registrarFeedback,
  NOME_DO_ARQUIVO_DA_FOTO,
} from './guardaRoupa.js'

// O guarda-roupa segue o caminho das anotações e dos projetos — cache neste
// aparelho para a tela nunca nascer vazia, Drive como fonte de verdade — num
// arquivo próprio (guarda-roupa.json). A diferença é quem mais escreve nele:
// o Claude classifica as peças e grava o look do dia de manhã, com o app
// possivelmente aberto desde a véspera. Por isso o arquivo é relido quando a
// tela volta a ficar visível, e não só na abertura.
const CACHE_KEY = 'gestao-agenda:guarda-roupa-cache'
const SAVE_DEBOUNCE_MS = 1000
const RELER_DEPOIS_DE_MS = 2 * 60 * 1000

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return normalizarGuardaRoupa(raw ? JSON.parse(raw) : null)
  } catch {
    return normalizarGuardaRoupa(null)
  }
}

function writeCache(estado) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(estado))
  } catch {
    // Sem espaço: o que está na tela continua valendo e o Drive ainda é tentado.
  }
}

export default function useGuardaRoupa({ signedIn }) {
  const [estado, setEstado] = useState(readCache)
  const [error, setError] = useState(null)
  const [syncStatus, setSyncStatus] = useState('ocioso')
  const estadoRef = useRef(estado)
  const saveTimer = useRef(null)
  const lidoEm = useRef(0)
  const lendo = useRef(false)

  function aplicar(novo) {
    estadoRef.current = novo
    setEstado(novo)
    writeCache(novo)
  }

  async function subir() {
    setSyncStatus('salvando')
    try {
      // O que está no Drive agora entra na conta antes de gravar: a
      // classificação que o Claude acabou de fazer não pode sumir porque uma
      // peça foi editada aqui.
      const doDrive = await loadGuardaRoupa()
      const locais = estadoRef.current
      const paraGravar = doDrive === null ? locais : mesclarGuardaRoupa(locais, normalizarGuardaRoupa(doDrive))
      if (difere(paraGravar, locais)) aplicar(paraGravar)
      await saveGuardaRoupa(paraGravar)
      lidoEm.current = Date.now()
      setSyncStatus('salvo')
      setError(null)
    } catch (err) {
      console.error('Não foi possível sincronizar o guarda-roupa com o Drive:', err)
      setSyncStatus('erro')
      setError(descreverFalha(err, 'A última alteração do guarda-roupa ficou salva só neste aparelho'))
    }
  }

  async function ler() {
    if (lendo.current) return
    lendo.current = true
    try {
      const doDrive = await loadGuardaRoupa()
      lidoEm.current = Date.now()
      setError(null)
      if (doDrive === null) {
        // Ainda não existe arquivo no Drive: o que há aqui é a única cópia.
        if (estadoRef.current.pecas.length || estadoRef.current.looks.length) await subir()
        else setSyncStatus('salvo')
        return
      }
      const remoto = normalizarGuardaRoupa(doDrive)
      const mesclado = mesclarGuardaRoupa(estadoRef.current, remoto)
      if (difere(mesclado, estadoRef.current)) aplicar(mesclado)
      if (difere(mesclado, remoto)) await subir()
      else setSyncStatus('salvo')
    } catch (err) {
      console.error('Não foi possível carregar o guarda-roupa do Drive:', err)
      setError(descreverFalha(err, 'Mostrando o guarda-roupa salvo neste aparelho'))
    } finally {
      lendo.current = false
    }
  }

  useEffect(() => {
    if (!signedIn) return undefined
    if (permissaoDoDriveConcedida() === false) {
      setError(MSG_SEM_PERMISSAO)
      return undefined
    }
    ler()
    function aoVoltar() {
      if (document.visibilityState === 'visible' && Date.now() - lidoEm.current > RELER_DEPOIS_DE_MS) ler()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => document.removeEventListener('visibilitychange', aoVoltar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  function persist(novo) {
    aplicar(novo)
    setSyncStatus('salvando')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => subir(), SAVE_DEBOUNCE_MS)
  }

  // Reduz a foto, manda para a pasta "Guarda-roupa" do Drive e cadastra a
  // peça. Quem chama trata o erro (falta de permissão pede o botão
  // "Permitir", e isso é assunto da tela).
  async function adicionarPeca(arquivo, campos = {}, aoProgredir = () => {}) {
    const agora = new Date()
    const reduzida = await reduzirImagem(arquivo)
    const pasta = await pastaDoGuardaRoupa()
    const paraEnviar = new File([reduzida], NOME_DO_ARQUIVO_DA_FOTO(agora), { type: 'image/jpeg' })
    const doDrive = await enviarArquivoAoDrive(pasta.id, paraEnviar, aoProgredir)
    guardarFoto(doDrive.id, reduzida)
    const peca = novaPeca({ ...campos, foto: { driveId: doDrive.id, url: doDrive.webViewLink || '' } }, agora)
    persist({ ...estadoRef.current, pecas: [peca, ...estadoRef.current.pecas] })
    return peca
  }

  function salvarPeca(id, campos) {
    const atual = estadoRef.current
    persist({ ...atual, pecas: atual.pecas.map((p) => (p.id === id ? editarPeca(p, campos, new Date()) : p)) })
  }

  // A foto vai para a lixeira do Drive (recuperável por 30 dias), como os
  // arquivos dos projetos; a peça sai da lista deixando o rastro, para não
  // voltar pelo outro aparelho nem pelo conector.
  async function excluirPeca(id) {
    const atual = estadoRef.current
    const peca = atual.pecas.find((p) => p.id === id)
    if (!peca) return
    try {
      await mandarParaLixeira(peca.foto.driveId)
    } catch (err) {
      // Já não existe no Drive: não há o que mandar para a lixeira.
      if (err?.status !== 404) throw err
    }
    esquecerFoto(peca.foto.driveId)
    const agora = estadoRef.current
    persist({
      ...agora,
      pecas: agora.pecas.filter((p) => p.id !== id),
      deleted: [...agora.deleted.filter((d) => d.id !== id), { id, at: new Date().toISOString() }],
    })
  }

  // "Usei este" / "Não gostei" do cartão da tela inicial. A regra (somar o
  // uso, gravar a data, não contar duas vezes) é a de guardaRoupa.js, a
  // mesma da ferramenta do conector.
  function responderLook(data, feedback, motivo = '') {
    const feito = registrarFeedback(estadoRef.current, { data, feedback, motivo }, new Date())
    if (feito) persist({ ...estadoRef.current, pecas: feito.pecas, looks: feito.looks })
  }

  return {
    pecas: estado.pecas,
    looks: estado.looks,
    adicionarPeca,
    salvarPeca,
    excluirPeca,
    responderLook,
    syncStatus,
    error,
    dismissError: () => setError(null),
  }
}
