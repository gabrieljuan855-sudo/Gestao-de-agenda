import { useCallback, useState } from 'react'
import { listAllTasks, prefetchFocusEvents } from './googleApi.js'
import { fetchComentarioDaRevisao } from './aiRevisao.js'
import { IA_DESLIGADA } from './aiCooldown.js'
import { numerosDaRevisao } from './revisao.js'

// Ao contrário do briefing antigo, que rodava sozinho 3x por dia (e virou
// a Fase 5 justamente por isso — ver a análise de custo de IA da Fase 2), a
// revisão só busca dado quando a pessoa abre a tela: é sob demanda, do jeito
// que a revisão semanal do GTD é sempre tratada — um momento que a pessoa
// escolhe entrar, não uma notificação empurrada.
export default function useRevisao({ idProximas, idAguardando, entradaVazia }) {
  const [numeros, setNumeros] = useState(null)
  const [comentario, setComentario] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [error, setError] = useState(null)

  const gerar = useCallback(async () => {
    setCarregando(true)
    setError(null)
    try {
      // showCompleted: true e sem limite de período, porque "concluída nesta
      // semana" e "bloco de foco desta semana" olham para trás — o resto do
      // app carrega só o necessário para a tela aberta, mas a revisão precisa
      // do que aconteceu, não só do que ainda está pendente.
      const [tasks, focusEvents] = await Promise.all([
        listAllTasks({ showCompleted: true }),
        prefetchFocusEvents(),
      ])
      const numerosCalculados = numerosDaRevisao({ tasks, focusEvents, idProximas, idAguardando, entradaVazia })
      setNumeros(numerosCalculados)
      setComentario(null)

      if (IA_DESLIGADA) return
      try {
        setComentario(await fetchComentarioDaRevisao(numerosCalculados))
      } catch (err) {
        // Os números já apareceram e são o que importa; o comentário é só um
        // extra por cima deles, então a falha dele não pode esconder o
        // cálculo que já deu certo.
        console.error('Não foi possível gerar o comentário da revisão:', err)
        setError(`Os números estão certos, mas o comentário da IA não veio: ${err.message}`)
      }
    } catch (err) {
      console.error('Não foi possível calcular a revisão da semana:', err)
      setError(`Não deu para calcular a revisão: ${err.message}`)
    } finally {
      setCarregando(false)
    }
  }, [idProximas, idAguardando, entradaVazia])

  return { numeros, comentario, carregando, error, gerar, dismissError: () => setError(null) }
}
