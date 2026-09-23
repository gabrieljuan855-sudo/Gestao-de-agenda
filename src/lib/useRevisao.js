import { useCallback, useState } from 'react'
import { listAllTasks, listAllEvents, prefetchFocusEvents } from './googleApi.js'
import { fetchSugestoesDaRevisao } from './aiRevisao.js'
import { REVISAO_IA_LIGADA } from './aiCooldown.js'
import { startOfDay, addDays } from './dates.js'
import {
  numerosDaRevisao,
  itensDaRevisao,
  candidatasParaAgendar,
  vaosLivresDaSemana,
  cargaDaSemana,
  semanaEstaFolgada,
} from './revisao.js'

// Quantos dias à frente o plano da semana olha — hoje incluso. Uma semana de
// verdade, não o resto do calendário: até "próxima ação" perde a força se
// puder ser encaixada daqui a um mês.
const DIAS_PLANO = 7

// Ao contrário do briefing antigo, que rodava sozinho 3x por dia (e virou
// a Fase 5 justamente por isso — ver a análise de custo de IA da Fase 2), a
// revisão só busca dado quando a pessoa abre a tela: é sob demanda, do jeito
// que a revisão semanal do GTD é sempre tratada — um momento que a pessoa
// escolhe entrar, não uma notificação empurrada.
export default function useRevisao({ idProximas, idAguardando, idAlgumDia, entradaVazia, occupies, schedule }) {
  const [numeros, setNumeros] = useState(null)
  const [comentario, setComentario] = useState(null)
  // Cada sugestão/item do plano já vem casado com a tarefa dela, para a tela
  // conseguir executar a ação sem procurar nada de novo.
  const [sugestoes, setSugestoes] = useState([])
  const [plano, setPlano] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [error, setError] = useState(null)

  const gerar = useCallback(async () => {
    setCarregando(true)
    setError(null)
    try {
      const hoje = new Date()
      // showCompleted: true e sem limite de período nas tarefas, porque
      // "concluída nesta semana" olha para trás; os eventos, ao contrário,
      // olham só para a frente (os próximos DIAS_PLANO dias) — é aí que o
      // plano da semana vai propor horário.
      const [tasks, focusEvents, eventos] = await Promise.all([
        listAllTasks({ showCompleted: true }),
        prefetchFocusEvents(),
        listAllEvents({ timeMin: startOfDay(hoje), timeMax: addDays(startOfDay(hoje), DIAS_PLANO) }),
      ])

      const carga = cargaDaSemana({ tasks, events: eventos, schedule, occupies }, hoje, DIAS_PLANO)
      const numerosCalculados = {
        ...numerosDaRevisao({ tasks, focusEvents, idProximas, idAguardando, entradaVazia }, hoje),
        carga,
      }
      const itens = itensDaRevisao(
        { tasks, idProximas, idAguardando, idAlgumDia, incluirAlgumDia: semanaEstaFolgada(carga) },
        hoje
      )
      const candidatas = candidatasParaAgendar(tasks, idProximas)
      const vagas = vaosLivresDaSemana({ events: eventos, schedule, occupies }, hoje, DIAS_PLANO)

      setNumeros(numerosCalculados)
      setComentario(null)
      setSugestoes([])
      setPlano([])

      if (!REVISAO_IA_LIGADA) return
      try {
        const resposta = await fetchSugestoesDaRevisao(numerosCalculados, itens, candidatas, vagas)
        const itemPorId = new Map(itens.map((i) => [i.id, i]))
        const candidataPorId = new Map(candidatas.map((c) => [c.id, c]))
        setComentario(resposta.comentario || null)
        setSugestoes(
          resposta.sugestoes
            .filter((s) => itemPorId.has(s.itemId))
            .map((s) => ({ ...s, item: itemPorId.get(s.itemId) }))
        )
        setPlano(
          resposta.plano
            .filter((p) => candidataPorId.has(p.tarefaId))
            .map((p) => ({ ...p, candidata: candidataPorId.get(p.tarefaId) }))
        )
      } catch (err) {
        // Os números já apareceram e são o que importa; sugestões e plano são
        // só um extra por cima deles, então a falha deles não pode esconder o
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
  }, [idProximas, idAguardando, idAlgumDia, entradaVazia, occupies, schedule])

  return { numeros, comentario, sugestoes, plano, carregando, error, gerar, dismissError: () => setError(null) }
}
