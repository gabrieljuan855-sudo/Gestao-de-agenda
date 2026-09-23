import { describe, expect, it } from 'vitest'
import { construirRecorrencia, reconhecerRecorrencia, detectarRecorrencia } from './recorrencia.js'

describe('construirRecorrencia', () => {
  it('diária não depende da data', () => {
    expect(construirRecorrencia('diaria', new Date(2026, 8, 23))).toEqual(['RRULE:FREQ=DAILY'])
  })

  it('semanal usa o dia da semana da própria data (quarta = WE)', () => {
    // 2026-09-23 é uma quarta-feira.
    expect(construirRecorrencia('semanal', new Date(2026, 8, 23))).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=WE'])
  })

  it('mensal usa o dia do mês da própria data', () => {
    expect(construirRecorrencia('mensal', new Date(2026, 8, 23))).toEqual(['RRULE:FREQ=MONTHLY;BYMONTHDAY=23'])
  })

  it('anual não precisa de mais nada', () => {
    expect(construirRecorrencia('anual', new Date(2026, 8, 23))).toEqual(['RRULE:FREQ=YEARLY'])
  })

  it('"nunca" ou um id desconhecido não geram regra', () => {
    expect(construirRecorrencia('nunca', new Date())).toEqual([])
    expect(construirRecorrencia('outracoisa', new Date())).toEqual([])
  })
})

describe('reconhecerRecorrencia', () => {
  it('reconhece as quatro regras simples de volta', () => {
    expect(reconhecerRecorrencia(['RRULE:FREQ=DAILY'])).toBe('diaria')
    expect(reconhecerRecorrencia(['RRULE:FREQ=WEEKLY;BYDAY=WE'])).toBe('semanal')
    expect(reconhecerRecorrencia(['RRULE:FREQ=MONTHLY;BYMONTHDAY=23'])).toBe('mensal')
    expect(reconhecerRecorrencia(['RRULE:FREQ=YEARLY'])).toBe('anual')
  })

  it('sem recurrence (ou lista vazia) é "nunca"', () => {
    expect(reconhecerRecorrencia(undefined)).toBe('nunca')
    expect(reconhecerRecorrencia([])).toBe('nunca')
  })

  it('regra com INTERVAL, COUNT ou UNTIL vira "personalizada"', () => {
    expect(reconhecerRecorrencia(['RRULE:FREQ=DAILY;INTERVAL=2'])).toBe('personalizada')
    expect(reconhecerRecorrencia(['RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=5'])).toBe('personalizada')
    expect(reconhecerRecorrencia(['RRULE:FREQ=YEARLY;UNTIL=20301231T000000Z'])).toBe('personalizada')
  })

  it('mais de uma linha de RRULE (com EXDATE, por exemplo) vira "personalizada"', () => {
    expect(reconhecerRecorrencia(['RRULE:FREQ=WEEKLY;BYDAY=WE', 'EXDATE:20260101T000000Z'])).toBe('personalizada')
  })
})

describe('detectarRecorrencia', () => {
  it('reconhece as frases mais comuns de repetição em português', () => {
    expect(detectarRecorrencia('Reunião todos os dias 9h')).toBe('diaria')
    expect(detectarRecorrencia('Ginástica diariamente às 7h')).toBe('diaria')
    expect(detectarRecorrencia('Reunião toda segunda 14h')).toBe('semanal')
    expect(detectarRecorrencia('Reunião toda segunda-feira 14h')).toBe('semanal')
    expect(detectarRecorrencia('Relatório semanalmente')).toBe('semanal')
    expect(detectarRecorrencia('Pagar o boleto todo mês')).toBe('mensal')
    expect(detectarRecorrencia('Revisar contrato mensalmente')).toBe('mensal')
    expect(detectarRecorrencia('Aniversário todo ano')).toBe('anual')
  })

  it('sem nenhuma frase de repetição, devolve null', () => {
    expect(detectarRecorrencia('Reunião amanhã 14h')).toBe(null)
  })
})
