import { describe, expect, it } from 'vitest'
import { buscarNasNotas, combinaComABusca, radical, termosDaBusca, trechoDaBusca } from './notasBusca.js'

const nota = (id, title, body = '', extra = {}) => ({ id, title, body, updatedAt: '2026-10-30T10:00:00Z', ...extra })

describe('radical', () => {
  it('junta singular e plural e ignora acento', () => {
    expect(radical('editais')).toBe(radical('edital'))
    expect(radical('ações')).toBe(radical('ação'))
    expect(radical('Recursos')).toBe(radical('recurso'))
    expect(radical('família')).toBe(radical('familia'))
  })
})

describe('termosDaBusca', () => {
  it('descarta palavras vazias, mas não deixa a busca sem nada', () => {
    expect(termosDaBusca('editais para a população de rua')).toEqual(['edital', 'popula', 'rua'])
    expect(termosDaBusca('o que')).toEqual(['o', 'que'])
  })
})

describe('buscarNasNotas', () => {
  const notas = [
    nota('a', 'Recursos para PSR', 'Edital da prefeitura abre em março. Ver também o fundo estadual.'),
    nota('b', 'Reunião de equipe', 'Falamos de férias e do edital de compras, de passagem.'),
    nota('c', 'Caso Silva', 'Família em situação de rua desde maio; PSR acompanhada pelo CREAS.'),
    nota('d', 'Lista do mercado', 'arroz, feijão'),
  ]

  it('acha por palavra solta, fora de ordem, e põe o título na frente', () => {
    // "a" tem as duas palavras, uma delas no título; "b" e "c" têm uma cada.
    const r = buscarNasNotas(notas, 'editais PSR')
    expect(r[0].nota.id).toBe('a')
    expect(r.map((x) => x.nota.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('não traz nota sem nenhuma das palavras', () => {
    expect(buscarNasNotas(notas, 'audiência')).toEqual([])
    expect(buscarNasNotas(notas, '')).toEqual([])
  })

  it('a palavra rara pesa mais que a comum', () => {
    const r = buscarNasNotas(notas, 'edital mercado')
    expect(r[0].nota.id).toBe('d')
  })

  it('o título das fontes também conta', () => {
    const comFonte = [...notas, nota('e', 'Ideia', 'texto curto', { fontes: [{ titulo: 'Lei Orgânica da Assistência Social' }] })]
    expect(buscarNasNotas(comFonte, 'LOAS assistência')[0].nota.id).toBe('e')
  })

  it('respeita o limite', () => {
    expect(buscarNasNotas(notas, 'edital PSR rua', { limite: 1 })).toHaveLength(1)
  })
})

describe('combinaComABusca (lista do app)', () => {
  const n = nota('a', 'Caso Silva', 'Audiência marcada para dezembro')
  it('exige todas as palavras, em qualquer ordem, e aceita o começo da palavra', () => {
    expect(combinaComABusca(n, 'silva audiencia')).toBe(true)
    expect(combinaComABusca(n, 'sil')).toBe(true)
    expect(combinaComABusca(n, 'silva janeiro')).toBe(false)
    expect(combinaComABusca(n, '   ')).toBe(true)
  })
})

describe('trechoDaBusca', () => {
  it('recorta em volta da palavra, com o texto original e acentuado', () => {
    const texto = `${'Começo da nota sem nada de importante. '.repeat(6)}Aqui a Audiência foi remarcada para dezembro. ${'Fim. '.repeat(20)}`
    const trecho = trechoDaBusca(texto, 'audiencia', 80)
    expect(trecho).toContain('Audiência foi remarcada')
    expect(trecho.startsWith('…')).toBe(true)
    expect(trecho.endsWith('…')).toBe(true)
  })

  it('texto curto volta inteiro', () => {
    expect(trechoDaBusca('Só isto.', 'nada')).toBe('Só isto.')
  })
})
