import { describe, expect, it } from 'vitest'
import { kindForSlot } from './useBriefing.js'

// Segunda (21) a domingo (27) de setembro de 2026.
const segunda = new Date(2026, 8, 21)
const quarta = new Date(2026, 8, 23)
const sexta = new Date(2026, 8, 25)
const sabado = new Date(2026, 8, 26)

describe('kindForSlot', () => {
  it('segunda de manhã puxa a semana inteira, e não o dia', () => {
    expect(kindForSlot('manha', segunda)).toBe('semana_inicio')
  })

  it('outros dias úteis de manhã usam o briefing diário normal', () => {
    expect(kindForSlot('manha', quarta)).toBe('dia_manha')
    expect(kindForSlot('manha', sexta)).toBe('dia_manha')
  })

  it('tarde é sempre o briefing diário, em qualquer dia útil', () => {
    expect(kindForSlot('tarde', segunda)).toBe('dia_tarde')
    expect(kindForSlot('tarde', sexta)).toBe('dia_tarde')
  })

  it('sexta às 17h25 fecha a semana, e não só o dia', () => {
    expect(kindForSlot('recap', sexta)).toBe('semana_fim')
  })

  it('outros dias úteis às 17h25 usam o recap diário normal', () => {
    expect(kindForSlot('recap', segunda)).toBe('dia_recap')
    expect(kindForSlot('recap', quarta)).toBe('dia_recap')
  })

  it('fim de semana não gera briefing nenhum', () => {
    expect(kindForSlot('manha', sabado)).toBeNull()
    expect(kindForSlot('tarde', sabado)).toBeNull()
    expect(kindForSlot('recap', sabado)).toBeNull()
  })
})
