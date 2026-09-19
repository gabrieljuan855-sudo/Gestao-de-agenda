import { describe, it, expect } from 'vitest'
import { numerosDaRevisao } from './revisao.js'

const PROXIMAS = 'lista-proximas'
const AGUARDANDO = 'lista-aguardando'

function agora() {
  // Quarta-feira, no meio da semana, para inicio/fim de semana serem estáveis.
  return new Date('2026-09-16T12:00:00')
}

describe('numerosDaRevisao', () => {
  it('conta atrasada e parada a partir das tarefas pendentes', () => {
    const tasks = [
      { id: '1', status: 'needsAction', due: '2026-09-10T00:00:00.000Z', updated: '2026-09-10T00:00:00.000Z' },
      // `isStalledTask` mede a idade contra o relógio real (não o `now` da
      // revisão), então uma tarefa "recente" de verdade precisa da hora atual.
      { id: '2', status: 'needsAction', due: null, updated: new Date().toISOString() },
    ]
    const numeros = numerosDaRevisao({ tasks, idProximas: PROXIMAS, idAguardando: AGUARDANDO }, agora())
    expect(numeros.atrasadas).toBe(1)
    expect(numeros.paradas).toBe(1)
  })

  it('aponta projeto sem próxima ação, reaproveitando a mesma regra da Fase 3', () => {
    const tasks = [{ id: '1', status: 'needsAction', projeto: 'caso-silva', tasklistId: AGUARDANDO }]
    const numeros = numerosDaRevisao({ tasks, idProximas: PROXIMAS, idAguardando: AGUARDANDO }, agora())
    expect(numeros.projetosParados).toEqual(['caso-silva'])
  })

  it('lista quem está esperando há uma semana ou mais, ordenado do mais velho', () => {
    const tasks = [
      { id: '1', status: 'needsAction', tasklistId: AGUARDANDO, title: 'recente', aguardando: { quem: 'ana', desde: '2026-09-14' } },
      { id: '2', status: 'needsAction', tasklistId: AGUARDANDO, title: 'antiga', aguardando: { quem: 'joao', desde: '2026-09-01' } },
    ]
    const numeros = numerosDaRevisao({ tasks, idProximas: PROXIMAS, idAguardando: AGUARDANDO }, agora())
    expect(numeros.aguardandoEnvelhecendo.map((a) => a.title)).toEqual(['antiga'])
  })

  it('conta concluídas e foco só dentro da semana atual', () => {
    const tasks = [
      { id: '1', status: 'completed', completed: '2026-09-15T10:00:00.000Z' }, // dentro da semana
      { id: '2', status: 'completed', completed: '2026-08-01T10:00:00.000Z' }, // fora
    ]
    const focusEvents = [
      { start: { dateTime: '2026-09-15T09:00:00.000Z' }, end: { dateTime: '2026-09-15T09:25:00.000Z' } }, // dentro
      { start: { dateTime: '2026-08-01T09:00:00.000Z' }, end: { dateTime: '2026-08-01T09:25:00.000Z' } }, // fora
    ]
    const numeros = numerosDaRevisao(
      { tasks, focusEvents, idProximas: PROXIMAS, idAguardando: AGUARDANDO },
      agora()
    )
    expect(numeros.concluidasNaSemana).toBe(1)
    expect(numeros.blocosDeFoco).toBe(1)
    expect(numeros.minutosDeFoco).toBe(25)
  })

  it('propaga entradaVazia como veio', () => {
    expect(numerosDaRevisao({ tasks: [], entradaVazia: true }, agora()).entradaVazia).toBe(true)
    expect(numerosDaRevisao({ tasks: [], entradaVazia: false }, agora()).entradaVazia).toBe(false)
  })

  it('não quebra sem tarefas nem eventos de foco', () => {
    const numeros = numerosDaRevisao({ tasks: [], idProximas: PROXIMAS, idAguardando: AGUARDANDO }, agora())
    expect(numeros).toMatchObject({
      atrasadas: 0,
      paradas: 0,
      projetosParados: [],
      aguardandoEnvelhecendo: [],
      concluidasNaSemana: 0,
      blocosDeFoco: 0,
      minutosDeFoco: 0,
    })
  })
})
