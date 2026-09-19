import { describe, expect, it } from 'vitest'
import { normalizeAnalysis, normalizeBriefing, normalizeEsclarecer, normalizeSearch } from './index.js'

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
    // foi realmente oferecida no prompt.
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

describe('normalizeEsclarecer', () => {
  it('mantém uma proposta bem formada', () => {
    expect(
      normalizeEsclarecer({
        tipo: 'acao',
        titulo: 'Ligar para a escola sobre a vaga do João',
        contexto: 'ligar',
        quem: null,
        date: null,
        time: null,
      })
    ).toEqual({
      tipo: 'acao',
      titulo: 'Ligar para a escola sobre a vaga do João',
      contexto: 'ligar',
      quem: null,
      date: null,
      time: null,
    })
  })

  it('normaliza o contexto para uma etiqueta gravável', () => {
    // O contexto vira "@algo" dentro da nota, onde espaço é separador e
    // acento criaria dois contextos para a mesma coisa.
    expect(normalizeEsclarecer({ tipo: 'acao', contexto: 'No Computador' }).contexto).toBe('no-computador')
    expect(normalizeEsclarecer({ tipo: 'acao', contexto: 'Ligação' }).contexto).toBe('ligacao')
    expect(normalizeEsclarecer({ tipo: 'acao', contexto: '   ' }).contexto).toBe(null)
  })

  it('descarta tipo que não existe', () => {
    expect(normalizeEsclarecer({ tipo: 'inventado' }).tipo).toBe(null)
  })

  it('só aceita "quem" quando o tipo é aguardando', () => {
    // Um nome de pessoa colado numa ação comum viraria uma espera falsa na
    // lista de Aguardando.
    expect(normalizeEsclarecer({ tipo: 'aguardando', quem: 'Ana' }).quem).toBe('Ana')
    expect(normalizeEsclarecer({ tipo: 'acao', quem: 'Ana' }).quem).toBe(null)
  })

  it('valida data e hora no formato esperado', () => {
    expect(normalizeEsclarecer({ tipo: 'agendar', date: '2026-09-20', time: '14:00' })).toMatchObject({
      date: '2026-09-20',
      time: '14:00',
    })
    expect(normalizeEsclarecer({ tipo: 'agendar', date: '20/09/2026', time: '25:00' })).toMatchObject({
      date: null,
      time: null,
    })
  })

  it('corta título absurdamente longo e nunca quebra com resposta vazia', () => {
    expect(normalizeEsclarecer({ tipo: 'acao', titulo: 'x'.repeat(500) }).titulo.length).toBe(300)
    expect(normalizeEsclarecer({})).toEqual({
      tipo: null,
      titulo: '',
      contexto: null,
      quem: null,
      date: null,
      time: null,
    })
    expect(normalizeEsclarecer(null).tipo).toBe(null)
  })
})
