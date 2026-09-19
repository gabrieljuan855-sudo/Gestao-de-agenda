import { describe, expect, it } from 'vitest'
import { ordenarTarefasPorPrazo, isOverdueTask, isStalledTask } from './tasks.js'

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
    // O caso real: sempre que a lista é cortada por um teto, a tarefa que
    // está para vencer não pode ficar de fora só porque a API devolveu uma
    // dúzia de tarefas sem prazo nenhum antes dela.
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

describe('isOverdueTask', () => {
  const agora = new Date('2026-09-19T10:00:00')

  it('só conta depois que o dia do prazo passou inteiro', () => {
    expect(isOverdueTask({ due: '2026-09-18T00:00:00.000Z' }, agora)).toBe(true)
    // Vence hoje ainda não é atrasada.
    expect(isOverdueTask({ due: '2026-09-19T00:00:00.000Z' }, agora)).toBe(false)
    expect(isOverdueTask({ due: '2026-09-20T00:00:00.000Z' }, agora)).toBe(false)
  })

  it('não vale para tarefa sem prazo nem para concluída', () => {
    expect(isOverdueTask({}, agora)).toBe(false)
    expect(isOverdueTask({ due: '2026-09-01T00:00:00.000Z', status: 'completed' }, agora)).toBe(false)
  })
})

describe('isStalledTask', () => {
  it('marca o que está parado há três dias ou mais', () => {
    const tresDias = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    expect(isStalledTask({ updated: tresDias })).toBe(true)
    expect(isStalledTask({ updated: ontem })).toBe(false)
  })

  it('concluída nunca está parada', () => {
    const antiga = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    expect(isStalledTask({ updated: antiga, status: 'completed' })).toBe(false)
  })
})
