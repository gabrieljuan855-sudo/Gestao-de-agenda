import { describe, expect, it } from 'vitest'
import { tituloDaNota, previaDaNota, grupoDaData, dataCurta, organizarNotas, notaVazia, dataPorExtenso } from './notasLista.js'
import { sanitizeNote } from './useNotes.js'

const agora = new Date(2026, 9, 22, 23, 30)
const nota = (id, updatedAt, extra = {}) => ({ id, title: '', body: '', updatedAt: updatedAt.toISOString(), ...extra })

describe('título e prévia', () => {
  it('sem título, a primeira linha do texto é o título e a segunda é a prévia', () => {
    const n = { title: '', body: '\nCompras\nleite\npão' }
    expect(tituloDaNota(n)).toBe('Compras')
    expect(previaDaNota(n)).toBe('leite')
  })

  it('com título, a prévia é o começo do texto', () => {
    expect(previaDaNota({ title: 'Reunião', body: 'pauta do dia' })).toBe('pauta do dia')
  })

  it('nota em branco tem nome e prévia próprios', () => {
    expect(tituloDaNota({ title: ' ', body: '' })).toBe('Nova anotação')
    expect(previaDaNota({ title: 'Só título', body: '' })).toBe('Nenhum texto adicional')
    expect(notaVazia({ title: ' ', body: '\n' })).toBe(true)
    expect(notaVazia({ title: '', body: 'x' })).toBe(false)
  })
})

describe('datas', () => {
  it('agrupa como o Notas: hoje, ontem, 7 dias, 30 dias, mês, ano', () => {
    expect(grupoDaData(new Date(2026, 9, 22, 8).toISOString(), agora)).toBe('Hoje')
    expect(grupoDaData(new Date(2026, 9, 21, 23).toISOString(), agora)).toBe('Ontem')
    expect(grupoDaData(new Date(2026, 9, 17).toISOString(), agora)).toBe('7 dias anteriores')
    expect(grupoDaData(new Date(2026, 9, 1).toISOString(), agora)).toBe('30 dias anteriores')
    expect(grupoDaData(new Date(2026, 4, 10).toISOString(), agora)).toBe('Maio')
    expect(grupoDaData(new Date(2025, 4, 10).toISOString(), agora)).toBe('2025')
  })

  it('data curta: hora hoje, "Ontem", dia da semana, depois a data', () => {
    expect(dataCurta(new Date(2026, 9, 22, 9, 5).toISOString(), agora)).toBe('09:05')
    expect(dataCurta(new Date(2026, 9, 21).toISOString(), agora)).toBe('Ontem')
    expect(dataCurta(new Date(2026, 9, 19).toISOString(), agora)).toBe('segunda-feira')
    expect(dataCurta(new Date(2026, 8, 3).toISOString(), agora)).toBe('03/09/26')
  })

  it('carimbo por extenso', () => {
    expect(dataPorExtenso(new Date(2026, 9, 22, 23, 30).toISOString())).toBe('22 de outubro de 2026 às 23:30')
  })
})

describe('organizarNotas', () => {
  const lista = [
    nota('velha', new Date(2026, 4, 1), { body: 'Contrato de aluguel' }),
    nota('hoje', new Date(2026, 9, 22, 10), { title: 'Revisão', body: 'números da semana' }),
    nota('fixa', new Date(2026, 0, 1), { title: 'Senhas do Wi-Fi', fixada: true }),
    nota('ontem', new Date(2026, 9, 21), { title: 'Reunião' }),
  ]

  it('fixadas primeiro, depois por data, mais recentes em cima', () => {
    const secoes = organizarNotas(lista, agora)
    expect(secoes.map((s) => [s.titulo, s.notas.map((n) => n.id)])).toEqual([
      ['Fixadas', ['fixa']],
      ['Hoje', ['hoje']],
      ['Ontem', ['ontem']],
      ['Maio', ['velha']],
    ])
  })

  it('busca no título e no texto, sem ligar para acento ou maiúscula', () => {
    expect(organizarNotas(lista, agora, 'NUMEROS').flatMap((s) => s.notas.map((n) => n.id))).toEqual(['hoje'])
    expect(organizarNotas(lista, agora, 'reuniao').flatMap((s) => s.notas.map((n) => n.id))).toEqual(['ontem'])
    expect(organizarNotas(lista, agora, 'nada disso')).toEqual([])
  })
})

describe('fixada na sincronização', () => {
  it('sobrevive à limpeza da nota, e só existe quando é true', () => {
    expect(sanitizeNote({ id: 'a', fixada: true }).fixada).toBe(true)
    expect('fixada' in sanitizeNote({ id: 'a', fixada: 'sim' })).toBe(false)
    expect('fixada' in sanitizeNote({ id: 'a' })).toBe(false)
  })
})
