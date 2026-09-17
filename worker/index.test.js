import { describe, expect, it } from 'vitest'
import { normalizeAnalysis, normalizeBriefing, normalizeAgent, normalizeSearch } from './index.js'

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
    expect(normalizeAnalysis({})).toEqual({ title: '', suggestions: [], notaRelacionadaRef: null })
    expect(normalizeAnalysis(null)).toEqual({ title: '', suggestions: [], notaRelacionadaRef: null })
    expect(normalizeAnalysis({ suggestions: 'não é uma lista' })).toEqual({
      title: '',
      suggestions: [],
      notaRelacionadaRef: null,
    })
  })

  it('extrai telefone e e-mail do texto original da nota, só para sugestão de contato', () => {
    const result = normalizeAnalysis(
      { suggestions: [{ type: 'contato', text: 'Falar com a Ana' }] },
      { text: 'Ligar para a Ana no (11) 91234-5678 ou ana@exemplo.com quando puder.' }
    )
    expect(result.suggestions[0]).toMatchObject({ phone: '(11) 91234-5678', email: 'ana@exemplo.com' })
  })

  it('não inventa telefone/e-mail quando o texto não traz nenhum, e não extrai para outros tipos', () => {
    const semContato = normalizeAnalysis(
      { suggestions: [{ type: 'contato', text: 'Falar com a Ana' }] },
      { text: 'Falar com a Ana sobre o caso.' }
    )
    expect(semContato.suggestions[0]).toMatchObject({ phone: null, email: null })

    const outroTipo = normalizeAnalysis(
      { suggestions: [{ type: 'tarefa', text: 'Ligar depois' }] },
      { text: 'Ligar depois para (11) 91234-5678.' }
    )
    expect(outroTipo.suggestions[0].phone).toBeUndefined()
  })

  it('aceita nota relacionada só quando a referência está dentro da lista oferecida', () => {
    const valida = normalizeAnalysis({ notaRelacionadaRef: 'n2' }, { notasCount: 3 })
    expect(valida.notaRelacionadaRef).toBe('n2')

    // O caso que importa: o modelo apontou uma referência fora da lista que
    // foi realmente oferecida no prompt — igual ao que normalizeAgent faz
    // para referências de evento/tarefa.
    const foraDoIntervalo = normalizeAnalysis({ notaRelacionadaRef: 'n5' }, { notasCount: 3 })
    expect(foraDoIntervalo.notaRelacionadaRef).toBe(null)

    const semLista = normalizeAnalysis({ notaRelacionadaRef: 'n1' })
    expect(semLista.notaRelacionadaRef).toBe(null)

    const formatoInvalido = normalizeAnalysis({ notaRelacionadaRef: 'evento-3' }, { notasCount: 5 })
    expect(formatoInvalido.notaRelacionadaRef).toBe(null)
  })
})

describe('normalizeSearch', () => {
  it('mantém a resposta e as referências que estão dentro da lista oferecida', () => {
    const result = normalizeSearch({ answer: 'Você anotou isso na nota do caso Fulano.', refs: ['n1', 'n3'] }, { notasCount: 4 })
    expect(result).toEqual({ answer: 'Você anotou isso na nota do caso Fulano.', refs: ['n1', 'n3'] })
  })

  it('descarta referência fora da lista, repetida ou de formato errado', () => {
    // O caso que importa: o modelo citou uma nota que nunca foi oferecida no
    // prompt — aceitar isso levaria a pessoa para o lugar errado ao clicar.
    const result = normalizeSearch({ answer: 'x', refs: ['n1', 'n1', 'n9', 'evento-1', 42] }, { notasCount: 2 })
    expect(result.refs).toEqual(['n1'])
  })

  it('limita a 8 referências e corta uma resposta absurdamente longa', () => {
    const refs = Array.from({ length: 12 }, (_, i) => `n${i + 1}`)
    const result = normalizeSearch({ answer: 'x'.repeat(1000), refs }, { notasCount: 12 })
    expect(result.refs).toHaveLength(8)
    expect(result.answer.length).toBe(600)
  })

  it('nunca quebra com uma resposta vazia ou malformada', () => {
    expect(normalizeSearch({})).toEqual({ answer: '', refs: [] })
    expect(normalizeSearch(null)).toEqual({ answer: '', refs: [] })
    expect(normalizeSearch({ refs: 'não é uma lista' })).toEqual({ answer: '', refs: [] })
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
