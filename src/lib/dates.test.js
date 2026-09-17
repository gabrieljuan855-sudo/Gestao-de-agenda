import { describe, expect, it } from 'vitest'
import { rangeForView, toDateInput, fromInputs, formatDuration, addDays, startOfWeek } from './dates.js'

describe('toDateInput / fromInputs', () => {
  it('não muda de dia por causa de fuso (o bug clássico do toISOString)', () => {
    // Meia-noite local: toISOString() jogaria isso para o dia anterior em
    // fusos negativos (Brasil incluso) — foi exatamente o bug que motivou o
    // comentário original no código.
    const meiaNoite = new Date(2026, 8, 17, 0, 0, 0)
    expect(toDateInput(meiaNoite)).toBe('2026-09-17')
  })

  it('fromInputs reconstrói a mesma data/hora locais que toDateInput/toTimeInput leram', () => {
    const d = fromInputs('2026-09-17', '14:30')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8) // setembro = índice 8
    expect(d.getDate()).toBe(17)
    expect(d.getHours()).toBe(14)
    expect(d.getMinutes()).toBe(30)
  })
})

describe('formatDuration', () => {
  it('minutos puros', () => {
    expect(formatDuration(45)).toBe('45min')
  })
  it('horas exatas', () => {
    expect(formatDuration(120)).toBe('2h')
  })
  it('horas com minutos, sempre com dois dígitos', () => {
    expect(formatDuration(90)).toBe('1h30')
    expect(formatDuration(65)).toBe('1h05')
  })
})

describe('rangeForView', () => {
  // Quarta-feira, para não cair perto da virada de semana/mês e confundir o
  // teste com a folga que a própria função já dá nas bordas.
  const quarta = new Date(2026, 8, 16)

  it('dia: cobre o dia inteiro com folga de um dia para cada lado', () => {
    const { timeMin, timeMax } = rangeForView('day', quarta)
    expect(toDateInput(timeMin)).toBe('2026-09-15')
    expect(toDateInput(timeMax)).toBe('2026-09-17')
  })

  it('semana: cobre de segunda a domingo com folga de um dia', () => {
    const { timeMin, timeMax } = rangeForView('week', quarta)
    const segunda = startOfWeek(quarta)
    expect(toDateInput(timeMin)).toBe(toDateInput(addDays(segunda, -1)))
    expect(toDateInput(timeMax)).toBe(toDateInput(addDays(segunda, 7)))
  })

  it('mês: cobre o mês inteiro com folga de uma semana de cada lado', () => {
    const { timeMin, timeMax } = rangeForView('month', quarta)
    expect(timeMin < new Date(2026, 8, 1)).toBe(true)
    expect(timeMax > new Date(2026, 8, 30, 23, 59, 59)).toBe(true)
  })
})
