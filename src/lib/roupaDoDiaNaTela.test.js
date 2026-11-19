import { describe, expect, it } from 'vitest'
import { roupaDoDiaVisivel, msAteOLimite } from './roupaDoDiaNaTela.js'

const as = (h, m = 0) => new Date(2026, 10, 19, h, m)

describe('roupa do dia na tela', () => {
  it('aparece só antes das 8h', () => {
    expect(roupaDoDiaVisivel(as(5, 30), '2026-11-19', null)).toBe(true)
    expect(roupaDoDiaVisivel(as(7, 59), '2026-11-19', null)).toBe(true)
    expect(roupaDoDiaVisivel(as(8, 0), '2026-11-19', null)).toBe(false)
    expect(roupaDoDiaVisivel(as(21), '2026-11-19', null)).toBe(false)
  })

  it('tirada da tela some no dia e volta no seguinte', () => {
    expect(roupaDoDiaVisivel(as(6), '2026-11-19', '2026-11-19')).toBe(false)
    expect(roupaDoDiaVisivel(as(6), '2026-11-20', '2026-11-19')).toBe(true)
  })

  it('conta o tempo até as 8h, e zero depois', () => {
    expect(msAteOLimite(as(7, 30))).toBe(30 * 60 * 1000)
    expect(msAteOLimite(as(9))).toBe(0)
  })
})
