import { describe, it, expect } from 'vitest'
import {
  numerosDaRevisao,
  itensDaRevisao,
  candidatasParaAgendar,
  vaosLivresDaSemana,
  cargaDaSemana,
  semanaEstaFolgada,
} from './revisao.js'

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

  it('para em 15 itens, para a IA receber só o que mais pesa', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      status: 'needsAction',
      title: `t${i}`,
      due: '2026-09-01T00:00:00.000Z',
      tasklistId: PROXIMAS,
    }))
    expect(itensDaRevisao({ tasks, ...ids }, agora())).toHaveLength(15)
  })

  it('traz próxima ação sem prazo vencido mas parada há dias, sem duplicar quem já é "atrasada"', () => {
    const tasks = [
      // Sem prazo, mas não mexida há mais de 3 dias: entra como "parada".
      { id: 'a', status: 'needsAction', title: 'Vaga', tasklistId: PROXIMAS, updated: '2026-09-10T00:00:00.000Z' },
      // Prazo vencido: já é "atrasada", não deve aparecer de novo como "parada".
      {
        id: 'b',
        status: 'needsAction',
        title: 'Vencida',
        tasklistId: PROXIMAS,
        due: '2026-09-01T00:00:00.000Z',
        updated: '2026-09-01T00:00:00.000Z',
      },
    ]
    const itens = itensDaRevisao({ tasks, ...ids }, agora())
    expect(itens.filter((i) => i.tipo === 'parada').map((i) => i.id)).toEqual(['a'])
  })

  it('só traz Algum dia quando incluirAlgumDia é true, os mais antigos primeiro', () => {
    const tasks = [
      { id: 'a', status: 'needsAction', title: 'Velho', tasklistId: ALGUM_DIA, updated: '2026-08-01T00:00:00.000Z' },
      { id: 'b', status: 'needsAction', title: 'Novo', tasklistId: ALGUM_DIA, updated: '2026-09-15T00:00:00.000Z' },
    ]
    expect(itensDaRevisao({ tasks, ...ids }, agora())).toEqual([])
    const itens = itensDaRevisao({ tasks, ...ids, incluirAlgumDia: true }, agora())
    expect(itens.map((i) => i.id)).toEqual(['a', 'b'])
    expect(itens[0].tipo).toBe('algum_dia')
  })
})

describe('candidatasParaAgendar', () => {
  it('traz só as tarefas de Próximas ações, ordenadas por prioridade e prazo, até o teto', () => {
    const tasks = [
      { id: 'a', status: 'needsAction', title: 'Baixa', tasklistId: PROXIMAS, priority: 'baixa' },
      { id: 'b', status: 'needsAction', title: 'Alta', tasklistId: PROXIMAS, priority: 'alta', due: '2026-09-20T00:00:00.000Z', duracao: 45 },
      { id: 'c', status: 'completed', title: 'Feita', tasklistId: PROXIMAS, priority: 'alta' },
      { id: 'd', status: 'needsAction', title: 'Outra lista', tasklistId: AGUARDANDO, priority: 'alta' },
    ]
    const r = candidatasParaAgendar(tasks, PROXIMAS, 5)
    expect(r.map((c) => c.id)).toEqual(['b', 'a'])
    expect(r[0]).toMatchObject({ titulo: 'Alta', prioridade: 'alta', prazo: '2026-09-20', duracao: 45 })
  })
})

describe('vaosLivresDaSemana', () => {
  // Quarta 2026-09-16 (dia 3) e quinta 2026-09-17 (dia 4) trabalham 09h-17h;
  // os outros dias da semana não têm expediente algum.
  const schedule = { 3: [['09:00', '17:00']], 4: [['09:00', '17:00']] }

  it('corta o vão de hoje a partir da hora atual, e mantém o dia seguinte inteiro', () => {
    const vagas = vaosLivresDaSemana({ events: [], schedule, occupies: () => true }, agora(), 2)
    expect(vagas).toEqual([
      { dia: '2026-09-16', inicio: '12:00', fim: '17:00', minutos: 300 },
      { dia: '2026-09-17', inicio: '09:00', fim: '17:00', minutos: 480 },
    ])
  })

  it('pula dia sem expediente e desconta evento que ocupa', () => {
    const events = [
      { start: { dateTime: '2026-09-17T10:00:00' }, end: { dateTime: '2026-09-17T11:00:00' } },
    ]
    const vagas = vaosLivresDaSemana({ events, schedule, occupies: () => true }, agora(), 5)
    const diaSeguinte = vagas.filter((v) => v.dia === '2026-09-17')
    expect(diaSeguinte).toEqual([
      { dia: '2026-09-17', inicio: '09:00', fim: '10:00', minutos: 60 },
      { dia: '2026-09-17', inicio: '11:00', fim: '17:00', minutos: 360 },
    ])
    // Sexta, sábado e domingo não têm expediente no schedule de teste.
    expect(vagas.some((v) => v.dia === '2026-09-18')).toBe(false)
  })
})

describe('cargaDaSemana e semanaEstaFolgada', () => {
  const schedule = { 3: [['09:00', '17:00']], 4: [['09:00', '17:00']] }

  it('soma a duração das tarefas com prazo na janela contra o vão livre no mesmo período', () => {
    const tasks = [
      { id: 'a', status: 'needsAction', due: '2026-09-16T00:00:00.000Z', duracao: 60 },
      // Sem duracao: entra com o palpite padrão de 30min.
      { id: 'b', status: 'needsAction', due: '2026-09-17T00:00:00.000Z' },
      // Fora da janela de 2 dias: não conta.
      { id: 'c', status: 'needsAction', due: '2026-09-25T00:00:00.000Z', duracao: 999 },
    ]
    const carga = cargaDaSemana({ tasks, events: [], schedule, occupies: () => true }, agora(), 2)
    expect(carga).toEqual({ minutosTarefas: 90, minutosLivres: 780 })
    expect(semanaEstaFolgada(carga)).toBe(true)
  })

  it('não está folgada sem vão livre nenhum, mesmo sem tarefa nenhuma', () => {
    expect(semanaEstaFolgada({ minutosTarefas: 0, minutosLivres: 0 })).toBe(false)
  })

  it('não está folgada quando as tarefas já tomam mais de 60% do vão livre', () => {
    expect(semanaEstaFolgada({ minutosTarefas: 500, minutosLivres: 780 })).toBe(false)
  })
})
