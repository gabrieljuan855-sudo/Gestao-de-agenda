import { describe, expect, it } from 'vitest'
import { montarLista, filtrarPorAgenda, quandoNaLista } from './listaAgenda.js'

const hoje = new Date(2026, 8, 29, 10, 0)
const ev = (id, calendarId, start, end) => ({ id, calendarId, start, end })
const eventos = [
  ev('a', 'aepeti', { dateTime: '2026-09-29T14:00:00' }, { dateTime: '2026-09-29T15:00:00' }),
  ev('b', 'creas', { dateTime: '2026-09-30T09:00:00' }, { dateTime: '2026-09-30T10:00:00' }),
  ev('c', 'aepeti', { date: '2026-10-22' }, { date: '2026-10-23' }),
  ev('d', 'aepeti', { date: '2026-09-20' }, { date: '2026-10-02' }), // férias em andamento
  ev('e', 'aepeti', { dateTime: '2026-09-28T09:00:00' }, { dateTime: '2026-09-28T10:00:00' }), // já passou
  ev('f', 'aepeti', { dateTime: '2027-03-01T09:00:00' }, { dateTime: '2027-03-01T10:00:00' }), // fora dos 90 dias
]

describe('filtrarPorAgenda', () => {
  it('sem agenda escolhida devolve tudo', () => {
    expect(filtrarPorAgenda(eventos, null)).toHaveLength(6)
  })
  it('com agenda, só os dela', () => {
    expect(filtrarPorAgenda(eventos, 'creas').map((e) => e.id)).toEqual(['b'])
  })
})

describe('montarLista', () => {
  it('agrupa por dia a partir de hoje, sem o que já passou nem o que está longe demais', () => {
    const grupos = montarLista(filtrarPorAgenda(eventos, 'aepeti'), hoje)
    expect(grupos.map((g) => [g.dia.getMonth() + 1, g.dia.getDate()])).toEqual([[9, 29], [10, 22]])
    expect(grupos[0].itens.map((i) => i.event.id)).toEqual(['d', 'a'])
  })

  it('compromisso de vários dias aparece uma vez só, marcado como em andamento', () => {
    const [primeiro] = montarLista(eventos, hoje)
    const ferias = primeiro.itens.find((i) => i.event.id === 'd')
    expect(ferias).toMatchObject({ emAndamento: true, variosDias: true })
    expect(montarLista(eventos, hoje).flatMap((g) => g.itens).filter((i) => i.event.id === 'd')).toHaveLength(1)
  })
})

describe('quandoNaLista', () => {
  it('horário, dia inteiro e período', () => {
    const grupos = montarLista(eventos, hoje)
    const itens = Object.fromEntries(grupos.flatMap((g) => g.itens).map((i) => [i.event.id, i]))
    expect(quandoNaLista(itens.a)).toBe('14:00–15:00')
    expect(quandoNaLista(itens.c)).toBe('Dia inteiro')
    expect(quandoNaLista(itens.d)).toBe('até 01/10')
  })
})
