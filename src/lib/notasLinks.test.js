import { describe, expect, it } from 'vitest'
import {
  extrairLinks,
  ligacoesDaNota,
  saudeDasNotas,
  indiceDeTitulos,
  resolverLink,
  linkEmDigitacao,
  completarLink,
  sugerirTitulos,
  renomearLinks,
  textoSemMarcacao,
} from './notasLinks.js'
import { previaDaNota } from './notasLista.js'
import { sanitizeNote, sanitizeFonte, juntarFontes } from './notasFormato.js'

const nota = (id, title, body = '', extra = {}) => ({ id, title, body, updatedAt: '2026-10-30T10:00:00Z', ...extra })

describe('extrairLinks', () => {
  it('acha os [[links]], sem repetir, ignorando apelido e seção', () => {
    expect(extrairLinks('Ver [[Audiência]] e [[Caso Silva|o caso]], de novo [[audiencia]] e [[Relatório#Conclusão]].')).toEqual([
      'Audiência',
      'Caso Silva',
      'Relatório',
    ])
  })

  it('não confunde colchete simples, link vazio ou quebrado em duas linhas', () => {
    expect(extrairLinks('[só colchete] [[ ]] [[meio\nlinha]] texto')).toEqual([])
    expect(extrairLinks('')).toEqual([])
  })
})

describe('ligações entre notas', () => {
  const notas = [
    nota('a', 'Audiência', 'Marcada. Ver [[Caso Silva]] e [[Ofício pendente]].'),
    nota('b', 'Caso Silva', 'Família acompanhada desde março.'),
    nota('c', '', 'Reunião de equipe\nfalar do [[caso silva]]'),
  ]

  it('liga pelo título sem ligar para acento e caixa, e diz o que ainda não existe', () => {
    const { ligaA } = ligacoesDaNota(notas[0], notas)
    expect(ligaA.map((l) => [l.titulo, l.nota?.id || null])).toEqual([
      ['Caso Silva', 'b'],
      ['Ofício pendente', null],
    ])
  })

  it('sabe quem cita a nota, inclusive nota sem título (vale a primeira linha)', () => {
    expect(ligacoesDaNota(notas[1], notas).citadaPor.map((n) => n.id)).toEqual(['a', 'c'])
    expect(resolverLink('reuniao de equipe', indiceDeTitulos(notas)).id).toBe('c')
  })

  it('título repetido resolve para a nota editada por último', () => {
    const repetidas = [nota('x', 'Ideias', '', { updatedAt: '2026-10-01T00:00:00Z' }), nota('y', 'ideias', '', { updatedAt: '2026-10-20T00:00:00Z' })]
    expect(resolverLink('Ideias', indiceDeTitulos(repetidas)).id).toBe('y')
  })
})

describe('saudeDasNotas', () => {
  it('aponta link quebrado, nota solta, título repetido e nota vazia', () => {
    const notas = [
      nota('a', 'Audiência', 'Ver [[Caso Silva]] e [[Não existe]]'),
      nota('b', 'Caso Silva', 'texto'),
      nota('c', 'Solta', 'ninguém me cita'),
      nota('d', 'Do projeto', 'solta, mas está num projeto', { projeto: 'caso-silva' }),
      nota('e', 'Audiência', 'segunda com o mesmo título', { updatedAt: '2026-09-01T00:00:00Z' }),
      nota('f', '', '  '),
    ]
    const s = saudeDasNotas(notas)
    expect(s.linksQuebrados.map((x) => [x.nota.id, x.alvo])).toEqual([['a', 'Não existe']])
    expect(s.soltas.map((n) => n.id)).toEqual(['c', 'e'])
    expect(s.duplicadas.map((g) => g.map((n) => n.id))).toEqual([['a', 'e']])
    expect(s.vazias.map((n) => n.id)).toEqual(['f'])
  })
})

describe('fontes da nota', () => {
  it('guarda título, link http(s), autor e data; descarta o resto', () => {
    expect(sanitizeFonte({ titulo: ' Lei 8.742 ', url: 'planalto.gov.br/lei', autor: 'Planalto', data: '1993-12-07', extra: 1 })).toEqual({
      titulo: 'Lei 8.742',
      url: 'https://planalto.gov.br/lei',
      autor: 'Planalto',
      data: '1993-12-07',
    })
    expect(sanitizeFonte({ titulo: 'x', url: 'javascript:alert(1)' })).toEqual({ titulo: 'x' })
    expect(sanitizeFonte({ url: 'https://a.com' })).toBeNull()
  })

  it('a nota sobrevive à limpeza com as fontes, sem repetir a mesma', () => {
    const limpa = sanitizeNote({ id: 'n', title: 't', body: '', fontes: [{ titulo: 'Artigo' }, { titulo: 'artigo' }, { lixo: true }] })
    expect(limpa.fontes).toEqual([{ titulo: 'Artigo' }])
    expect('fontes' in sanitizeNote({ id: 'n', fontes: [] })).toBe(false)
    expect(juntarFontes([{ titulo: 'A' }], [{ titulo: 'B' }, { titulo: 'a' }]).map((f) => f.titulo)).toEqual(['A', 'B'])
  })
})

describe('sugestões ao digitar [[', () => {
  it('percebe o link em digitação e o que já foi escrito', () => {
    expect(linkEmDigitacao('Ver [[Cas', 9)).toEqual({ inicio: 6, parcial: 'Cas' })
    expect(linkEmDigitacao('Ver [[', 6)).toEqual({ inicio: 6, parcial: '' })
    expect(linkEmDigitacao('Ver [[Caso]] e', 14)).toBeNull()
    expect(linkEmDigitacao('Ver [[Cas\nnova linha', 20)).toBeNull()
  })

  it('completa com o título e põe o cursor depois do ]], sem fechar duas vezes', () => {
    expect(completarLink('Ver [[Cas e mais', 9, 'Caso Silva')).toEqual({ texto: 'Ver [[Caso Silva]] e mais', cursor: 18 })
    expect(completarLink('Ver [[Cas]] e mais', 9, 'Caso Silva')).toEqual({ texto: 'Ver [[Caso Silva]] e mais', cursor: 18 })
    expect(completarLink('sem link', 3, 'X')).toBeNull()
  })

  it('sugere primeiro quem começa com o digitado, depois palavra, depois o resto', () => {
    const notas = [
      nota('a', 'Audiência do caso', '', { updatedAt: '2026-10-01T00:00:00Z' }),
      nota('b', 'Caso Silva', '', { updatedAt: '2026-10-02T00:00:00Z' }),
      nota('c', 'Ocaso', '', { updatedAt: '2026-10-03T00:00:00Z' }),
      nota('d', 'caso silva', '', { updatedAt: '2026-09-01T00:00:00Z' }),
      nota('e', '', ''),
      nota('f', 'Mercado'),
    ]
    expect(sugerirTitulos(notas, 'caso')).toEqual(['Caso Silva', 'Audiência do caso', 'Ocaso'])
    // Sem nada digitado, as mais recentes ("Mercado" é a última editada).
    expect(sugerirTitulos(notas, '', { excetoId: 'c', limite: 2 })).toEqual(['Mercado', 'Caso Silva'])
  })
})

describe('renomearLinks', () => {
  const base = () => [
    nota('a', 'Caso Silva', 'texto'),
    nota('b', 'Audiência', 'Ver [[Caso Silva]], [[caso silva|o caso]] e [[Caso Silva#Histórico]]. Também [[Outro]].'),
    nota('c', 'Solta', 'nada aqui'),
  ]

  it('reescreve os links do título antigo, mantendo apelido e seção', () => {
    const notas = base().map((n) => (n.id === 'a' ? { ...n, title: 'Família Silva' } : n))
    const { notas: novas, alteradas } = renomearLinks(notas, 'a', 'Caso Silva', '2026-10-31T00:00:00Z')
    expect(alteradas.map((n) => n.id)).toEqual(['b'])
    expect(novas.find((n) => n.id === 'b').body).toBe(
      'Ver [[Família Silva]], [[Família Silva|o caso]] e [[Família Silva#Histórico]]. Também [[Outro]].'
    )
    expect(novas.find((n) => n.id === 'b').updatedAt).toBe('2026-10-31T00:00:00.000Z')
    expect(novas.find((n) => n.id === 'c')).toBe(notas.find((n) => n.id === 'c'))
  })

  it('a nota alterada fica mais nova que a versão lida, mesmo com o relógio de outro aparelho adiantado', () => {
    const notas = base().map((n) => (n.id === 'a' ? { ...n, title: 'Família Silva' } : n.id === 'b' ? { ...n, updatedAt: '2026-12-01T00:00:00.000Z' } : n))
    const { alteradas } = renomearLinks(notas, 'a', 'Caso Silva', '2026-10-31T00:00:00.000Z')
    expect(alteradas[0].updatedAt).toBe('2026-12-01T00:00:00.001Z')
  })

  it('não mexe quando só mudou acento ou caixa, ou quando o título antigo era de outra nota também', () => {
    const soCaixa = base().map((n) => (n.id === 'a' ? { ...n, title: 'caso silva' } : n))
    expect(renomearLinks(soCaixa, 'a', 'Caso Silva').alteradas).toEqual([])
    const duplicada = [...base(), nota('d', 'Caso Silva', 'outra com o mesmo título')].map((n) =>
      n.id === 'a' ? { ...n, title: 'Família Silva' } : n
    )
    expect(renomearLinks(duplicada, 'a', 'Caso Silva').alteradas).toEqual([])
  })
})

describe('textoSemMarcacao', () => {
  it('mostra o nome (ou o apelido) no lugar da marcação, como o Obsidian fora da edição', () => {
    expect(textoSemMarcacao('Ver [[Caso Silva]], [[Audiência|a audiência]] e [[Relatório#Fim]].')).toBe('Ver Caso Silva, a audiência e Relatório.')
    expect(previaDaNota({ title: 'X', body: 'Ligado a [[Caso Silva]]' })).toBe('Ligado a Caso Silva')
  })
})
