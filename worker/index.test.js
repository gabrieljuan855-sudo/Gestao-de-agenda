import { describe, expect, it } from 'vitest'
import { normalizeAnalysis, normalizeCommand, normalizeBriefing } from './index.js'

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

describe('normalizeCommand', () => {
  it('mantém um comando de exclusão válido', () => {
    const result = normalizeCommand({
      action: 'excluir_evento',
      searchText: 'reunião com a família Silva',
      summary: 'Excluir a reunião com a família Silva.',
    })
    expect(result).toMatchObject({
      action: 'excluir_evento',
      searchText: 'reunião com a família Silva',
      title: '',
      date: null,
      time: null,
      presence: null,
    })
  })

  it('mantém um comando de confirmar presença, com a resposta certa', () => {
    const result = normalizeCommand({
      action: 'confirmar_presenca',
      searchText: 'reunião de amanhã',
      presence: 'nao',
    })
    expect(result.action).toBe('confirmar_presenca')
    expect(result.presence).toBe('nao')
  })

  it('descarta action e presence fora do vocabulário esperado', () => {
    const result = normalizeCommand({ action: 'formatar_disco', presence: 'inventado' })
    expect(result.action).toBe('desconhecido')
    expect(result.presence).toBeNull()
  })

  it('nunca quebra com uma resposta vazia ou malformada', () => {
    const vazio = normalizeCommand({})
    expect(vazio.action).toBe('desconhecido')
    expect(vazio.searchText).toBe('')
    expect(normalizeCommand(null).action).toBe('desconhecido')
  })
})

describe('normalizeBriefing', () => {
  it('mantém o texto e corta um texto absurdamente longo', () => {
    expect(normalizeBriefing({ text: 'Dia tranquilo, só duas reuniões.' })).toEqual({
      text: 'Dia tranquilo, só duas reuniões.',
    })
    expect(normalizeBriefing({ text: 'x'.repeat(1000) }).text.length).toBe(600)
  })

  it('nunca quebra com uma resposta vazia ou malformada', () => {
    expect(normalizeBriefing({})).toEqual({ text: '' })
    expect(normalizeBriefing(null)).toEqual({ text: '' })
    expect(normalizeBriefing({ text: 123 })).toEqual({ text: '' })
  })
})
