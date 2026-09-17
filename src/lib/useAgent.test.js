import { describe, expect, it } from 'vitest'
import { ordenarTarefasPorPrazo } from './useAgent.js'

describe('ordenarTarefasPorPrazo', () => {
  it('ordena pela data mais próxima primeiro', () => {
    const r = ordenarTarefasPorPrazo([
      { id: 'a', due: '2026-09-30' },
      { id: 'b', due: '2026-09-18' },
      { id: 'c', due: '2026-09-25' },
    ])
    expect(r.map((t) => t.id)).toEqual(['b', 'c', 'a'])
  })

  it('manda quem não tem prazo para o fim — sem data, não compete por espaço no corte', () => {
    // O caso real: com mais de MAX_TAREFAS pendentes, a tarefa que o usuário
    // pergunta (a mais perto de vencer) não pode ficar de fora só porque a
    // API devolveu ela depois de uma dúzia de tarefas sem prazo nenhum.
    const r = ordenarTarefasPorPrazo([
      { id: 'sem-prazo-1' },
      { id: 'com-prazo', due: '2026-09-20' },
      { id: 'sem-prazo-2' },
    ])
    expect(r.map((t) => t.id)).toEqual(['com-prazo', 'sem-prazo-1', 'sem-prazo-2'])
  })

  it('não muda a lista original', () => {
    const original = [{ id: 'a', due: '2026-09-30' }, { id: 'b', due: '2026-09-18' }]
    ordenarTarefasPorPrazo(original)
    expect(original.map((t) => t.id)).toEqual(['a', 'b'])
  })
})
