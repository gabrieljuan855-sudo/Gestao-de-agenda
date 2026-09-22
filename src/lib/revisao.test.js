import { describe, it, expect } from 'vitest'
import { numerosDaRevisao, itensDaRevisao } from './revisao.js'

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

describe('itensDaRevisao', () => {
  const ALGUM_DIA = 'lista-algum-dia'
  const ids = { idProximas: PROXIMAS, idAguardando: AGUARDANDO, idAlgumDia: ALGUM_DIA }

  it('traz a tarefa atrasada com quantos dias de atraso, a mais velha primeiro', () => {
    const tasks = [
      { id: 'a', status: 'needsAction', title: 'Relatório', due: '2026-09-14T00:00:00.000Z', tasklistId: PROXIMAS },
      { id: 'b', status: 'needsAction', title: 'Ofício', due: '2026-09-08T00:00:00.000Z', tasklistId: PROXIMAS },
    ]
    const itens = itensDaRevisao({ tasks, ...ids }, agora())
    expect(itens.map((i) => i.id)).toEqual(['b', 'a'])
    expect(itens[0]).toMatchObject({ tipo: 'atrasada', titulo: 'Ofício' })
    expect(itens[0].task.id).toBe('b')
  })

  it('não traz atrasada que já foi para Algum dia, nem concluída', () => {
    const tasks = [
      { id: 'a', status: 'needsAction', title: 'x', due: '2026-09-01T00:00:00.000Z', tasklistId: ALGUM_DIA },
      { id: 'b', status: 'completed', title: 'y', due: '2026-09-01T00:00:00.000Z', tasklistId: PROXIMAS },
    ]
    expect(itensDaRevisao({ tasks, ...ids }, agora())).toEqual([])
  })

  it('traz a espera de uma semana ou mais, com quem e há quantos dias', () => {
    const tasks = [
      { id: 'a', status: 'needsAction', title: 'Laudo', tasklistId: AGUARDANDO, aguardando: { quem: 'ana', desde: '2026-09-04' } },
      { id: 'b', status: 'needsAction', title: 'Recente', tasklistId: AGUARDANDO, aguardando: { quem: 'joao', desde: '2026-09-15' } },
    ]
    const itens = itensDaRevisao({ tasks, ...ids }, agora())
    expect(itens).toHaveLength(1)
    expect(itens[0]).toMatchObject({ id: 'a', tipo: 'aguardando', quem: 'ana', dias: 12 })
  })

  it('traz projeto sem próxima ação com as tarefas dele como contexto', () => {
    const tasks = [
      { id: 'a', status: 'needsAction', title: 'Esperar parecer', projeto: 'caso-maria', tasklistId: AGUARDANDO },
    ]
    const itens = itensDaRevisao({ tasks, ...ids }, agora())
    const projeto = itens.find((i) => i.tipo === 'projeto')
    expect(projeto).toMatchObject({ id: 'projeto:caso-maria', projeto: 'caso-maria', relacionadas: ['Esperar parecer'] })
  })

  it('para em 12 itens, para a IA receber só o que mais pesa', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      status: 'needsAction',
      title: `t${i}`,
      due: '2026-09-01T00:00:00.000Z',
      tasklistId: PROXIMAS,
    }))
    expect(itensDaRevisao({ tasks, ...ids }, agora())).toHaveLength(12)
  })
})
