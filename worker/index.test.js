import { describe, expect, it } from 'vitest'
import { normalizeAnalysis } from './index.js'

describe('normalizeAnalysis', () => {
  it('mantém sugestões válidas e usa o texto como título quando a IA não sugere um', () => {
    const result = normalizeAnalysis({
      title: 'Reunião do caso Fulano',
      suggestions: [{ type: 'tarefa', text: 'Ligar para a família', date: '2026-09-20' }],
    })
    expect(result.title).toBe('Reunião do caso Fulano')
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0]).toMatchObject({
      type: 'tarefa',
      text: 'Ligar para a família',
      title: 'Ligar para a família',
      date: '2026-09-20',
      time: null,
    })
  })

  it('descarta sugestão com tipo desconhecido ou sem texto', () => {
    const result = normalizeAnalysis({
      suggestions: [
        { type: 'invencionice', text: 'algo' },
        { type: 'tarefa', text: '' },
        { type: 'tarefa' },
      ],
    })
    expect(result.suggestions).toHaveLength(0)
  })

  it('só aceita data/hora para os tipos que fazem sentido (evento leva hora, tarefa não)', () => {
    const result = normalizeAnalysis({
      suggestions: [
        { type: 'evento', text: 'Reunião', date: '2026-09-20', time: '14:00' },
        { type: 'tarefa', text: 'Entregar relatório', date: '2026-09-21', time: '14:00' },
        { type: 'documento', text: 'Redigir parecer', date: '2026-09-21' },
      ],
    })
    expect(result.suggestions[0]).toMatchObject({ date: '2026-09-20', time: '14:00' })
    // Tarefa não tem hora marcada — mesmo que a IA mande uma, ela não conta.
    expect(result.suggestions[1]).toMatchObject({ date: '2026-09-21', time: null })
    // Documento não agenda nada.
    expect(result.suggestions[2]).toMatchObject({ date: null, time: null })
  })

  it('limita a 5 sugestões e corta um título absurdamente longo', () => {
    const suggestions = Array.from({ length: 8 }, (_, i) => ({ type: 'tarefa', text: `item ${i}` }))
    const result = normalizeAnalysis({ title: 'x'.repeat(200), suggestions })
    expect(result.suggestions).toHaveLength(5)
    expect(result.title.length).toBe(80)
  })

  it('nunca quebra com uma resposta vazia ou malformada', () => {
    expect(normalizeAnalysis({})).toEqual({ title: '', suggestions: [] })
    expect(normalizeAnalysis(null)).toEqual({ title: '', suggestions: [] })
    expect(normalizeAnalysis({ suggestions: 'não é uma lista' })).toEqual({ title: '', suggestions: [] })
  })
})
