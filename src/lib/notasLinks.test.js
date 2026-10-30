import { describe, expect, it } from 'vitest'
import { extrairLinks, ligacoesDaNota, saudeDasNotas, indiceDeTitulos, resolverLink } from './notasLinks.js'
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
