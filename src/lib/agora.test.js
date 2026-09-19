import { describe, it, expect } from 'vitest'
import { acoesParaAgora } from './agora.js'

function tarefa(overrides) {
  return { id: 't', status: 'needsAction', priority: 'media', contexto: null, duracao: null, due: null, ...overrides }
}

describe('acoesParaAgora', () => {
  it('exclui tarefa concluída', () => {
    const resultado = acoesParaAgora([tarefa({ id: 'a', status: 'completed' })])
    expect(resultado).toHaveLength(0)
  })

  it('filtra por contexto quando informado', () => {
    const tasks = [tarefa({ id: 'a', contexto: 'ligar' }), tarefa({ id: 'b', contexto: 'computador' })]
    const resultado = acoesParaAgora(tasks, { contexto: 'ligar' })
    expect(resultado.map((t) => t.id)).toEqual(['a'])
  })

  it('sem contexto informado, mostra tudo', () => {
    const tasks = [tarefa({ id: 'a', contexto: 'ligar' }), tarefa({ id: 'b', contexto: null })]
    const resultado = acoesParaAgora(tasks, {})
    expect(resultado).toHaveLength(2)
  })

  it('exclui tarefa cuja duração estimada não cabe no tempo livre', () => {
    const tasks = [tarefa({ id: 'a', duracao: 45 }), tarefa({ id: 'b', duracao: 10 })]
    const resultado = acoesParaAgora(tasks, { minutosDisponiveis: 15 })
    expect(resultado.map((t) => t.id)).toEqual(['b'])
  })

  it('tarefa sem estimativa nunca é excluída pelo filtro de tempo', () => {
    const tasks = [tarefa({ id: 'a', duracao: null })]
    const resultado = acoesParaAgora(tasks, { minutosDisponiveis: 5 })
    expect(resultado.map((t) => t.id)).toEqual(['a'])
  })

  it('ordena por prioridade e depois por prazo, igual ao Backlog', () => {
    const tasks = [
      tarefa({ id: 'baixa', priority: 'baixa' }),
      tarefa({ id: 'alta-sem-prazo', priority: 'alta' }),
      tarefa({ id: 'alta-com-prazo', priority: 'alta', due: '2026-01-01T00:00:00.000Z' }),
    ]
    const resultado = acoesParaAgora(tasks)
    expect(resultado.map((t) => t.id)).toEqual(['alta-com-prazo', 'alta-sem-prazo', 'baixa'])
  })

  it('lista vazia não quebra', () => {
    expect(acoesParaAgora([])).toEqual([])
    expect(acoesParaAgora(undefined)).toEqual([])
  })
})
