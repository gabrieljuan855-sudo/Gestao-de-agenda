import { useCallback, useState } from 'react'
import { listAllTasks, prefetchFocusEvents } from './googleApi.js'
import { fetchSugestoesDaRevisao } from './aiRevisao.js'
import { IA_DESLIGADA } from './aiCooldown.js'
import { numerosDaRevisao, itensDaRevisao } from './revisao.js'

// Ao contrário do briefing antigo, que rodava sozinho 3x por dia (e virou
// a Fase 5 justamente por isso — ver a análise de custo de IA da Fase 2), a
// revisão só busca dado quando a pessoa abre a tela: é sob demanda, do jeito
// que a revisão semanal do GTD é sempre tratada — um momento que a pessoa
// escolhe entrar, não uma notificação empurrada.
export default function useRevisao({ idProximas, idAguardando, idAlgumDia, entradaVazia }) {
  const [numeros, setNumeros] = useState(null)
  const [comentario, setComentario] = useState(null)
  // Cada sugestão já vem casada com o item dela (e a tarefa inteira), para a
  // tela conseguir executar a ação sem procurar nada de novo.
  const [sugestoes, setSugestoes] = useState([])
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
      const itens = itensDaRevisao({ tasks, idProximas, idAguardando, idAlgumDia })
      setNumeros(numerosCalculados)
      setComentario(null)
      setSugestoes([])

      if (IA_DESLIGADA) return
      try {
        const resposta = await fetchSugestoesDaRevisao(numerosCalculados, itens)
        const porId = new Map(itens.map((i) => [i.id, i]))
        setComentario(resposta.comentario || null)
        setSugestoes(
          resposta.sugestoes
            .filter((s) => porId.has(s.itemId))
            .map((s) => ({ ...s, item: porId.get(s.itemId) }))
        )
      } catch (err) {
        // Os números já apareceram e são o que importa; o comentário é só um
        // extra por cima deles, então a falha dele não pode esconder o
        // cálculo que já deu certo.
        console.error('Não foi possível gerar o comentário da revisão:', err)
        setError(`Os números estão certos, mas as sugestões da IA não vieram: ${err.message}`)
      }
    } catch (err) {
      console.error('Não foi possível calcular a revisão da semana:', err)
      setError(`Não deu para calcular a revisão: ${err.message}`)
    } finally {
      setCarregando(false)
    }
  }, [idProximas, idAguardando, idAlgumDia, entradaVazia])

  return { numeros, comentario, sugestoes, carregando, error, gerar, dismissError: () => setError(null) }
}
