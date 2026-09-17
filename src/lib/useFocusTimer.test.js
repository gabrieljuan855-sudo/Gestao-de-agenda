import { describe, expect, it } from 'vitest'
import { valeRegistrarBloco, formatClock } from './useFocusTimer.js'

const MINUTO = 60 * 1000

describe('valeRegistrarBloco', () => {
  const inicio = new Date('2026-09-17T14:00:00Z')

  it('registra um bloco encerrado no meio, com a duração real', () => {
    // O caso que motivou isto: focar 18 minutos e apertar Encerrar. A agenda
    // é o registro de onde o tempo foi — jogar fora era perder trabalho real.
    expect(valeRegistrarBloco(inicio, new Date(inicio.getTime() + 18 * MINUTO))).toBe(true)
    expect(valeRegistrarBloco(inicio, new Date(inicio.getTime() + 1 * MINUTO))).toBe(true)
  })

  it('ignora o toque sem querer no play', () => {
    expect(valeRegistrarBloco(inicio, new Date(inicio.getTime() + 5000))).toBe(false)
    expect(valeRegistrarBloco(inicio, inicio)).toBe(false)
  })

  it('não quebra sem as datas', () => {
    expect(valeRegistrarBloco(null, new Date())).toBe(false)
    expect(valeRegistrarBloco(inicio, null)).toBe(false)
  })
})

describe('formatClock', () => {
  it('mostra minutos e segundos com dois dígitos', () => {
    expect(formatClock(25 * MINUTO)).toBe('25:00')
    expect(formatClock(65 * 1000)).toBe('01:05')
  })

  it('nunca mostra tempo negativo', () => {
    expect(formatClock(-5000)).toBe('00:00')
  })
})
