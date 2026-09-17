import { describe, expect, it } from 'vitest'
import { normalizeAnalysis, normalizeBriefing, normalizeAgent } from './index.js'

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

describe('normalizeAgent', () => {
  const refs = ['e1', 'e2', 't1']

  it('aceita as ações bem formadas e numera os ids no servidor', () => {
    const r = normalizeAgent(
      {
        reply: 'Posso fazer isso.',
        actions: [
          { id: 'inventado', action: 'excluir_evento', ref: 'e1', resumo: 'Cancela a reunião' },
          { action: 'criar_tarefa', title: 'Ligar para a Ana', date: '2026-03-12', priority: 'alta' },
        ],
      },
      { refs }
    )
    expect(r.reply).toBe('Posso fazer isso.')
    expect(r.actions.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(r.actions[0].ref).toBe('e1')
    expect(r.actions[1].ref).toBe(null)
    expect(r.actions[1].priority).toBe('alta')
    expect(r.descartadas).toBe(0)
  })

  it('descarta ação que aponta para uma referência que nunca foi mostrada', () => {
    // O caso que importa: o modelo inventou um alvo. Executar isso significaria
    // mexer num compromisso que ninguém escolheu.
    const r = normalizeAgent({ actions: [{ action: 'excluir_evento', ref: 'e99' }] }, { refs })
    expect(r.actions).toEqual([])
    expect(r.descartadas).toBe(1)
  })

  it('descarta ação de tarefa que veio com referência de evento', () => {
    const r = normalizeAgent({ actions: [{ action: 'editar_tarefa', ref: 'e1', title: 'x' }] }, { refs })
    expect(r.actions).toEqual([])
    expect(r.descartadas).toBe(1)
  })

  it('exige referência em tudo que não for criar', () => {
    const r = normalizeAgent({ actions: [{ action: 'concluir_tarefa' }] }, { refs })
    expect(r.actions).toEqual([])
    expect(r.descartadas).toBe(1)
  })

  it('descarta ação de nome desconhecido e criação sem título', () => {
    const r = normalizeAgent(
      { actions: [{ action: 'formatar_disco' }, { action: 'criar_evento', title: '  ' }] },
      { refs }
    )
    expect(r.actions).toEqual([])
    expect(r.descartadas).toBe(2)
  })

  it('valida os campos dentro de cada ação, como as outras rotas', () => {
    const r = normalizeAgent(
      {
        actions: [
          {
            action: 'editar_evento',
            ref: 'e2',
            date: '12/03/2026',
            time: '25:00',
            durationMinutes: 20 * 60,
            priority: 'urgentíssima',
            presence: 'talvez',
          },
        ],
      },
      { refs }
    )
    const a = r.actions[0]
    expect(a.date).toBe(null)
    expect(a.time).toBe(null)
    expect(a.durationMinutes).toBe(null)
    expect(a.priority).toBe(null)
    expect(a.presence).toBe(null)
  })

  it('corta em 8 ações', () => {
    const actions = Array.from({ length: 12 }, () => ({ action: 'criar_tarefa', title: 'x' }))
    expect(normalizeAgent({ actions }, { refs }).actions.length).toBe(8)
  })

  it('nunca quebra com uma resposta vazia ou malformada', () => {
    expect(normalizeAgent({}, { refs })).toEqual({ reply: '', actions: [], descartadas: 0 })
    expect(normalizeAgent(null, { refs })).toEqual({ reply: '', actions: [], descartadas: 0 })
    expect(normalizeAgent({ actions: 'não é lista' }, { refs }).actions).toEqual([])
    // Sem contexto nenhum, nada que mexa em item existente pode passar.
    expect(normalizeAgent({ actions: [{ action: 'excluir_evento', ref: 'e1' }] }).actions).toEqual([])
  })
})
