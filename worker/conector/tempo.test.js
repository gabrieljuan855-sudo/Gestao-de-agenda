import { describe, expect, it } from 'vitest'
import { dataNoFuso, horaNoFuso, instanteNoFuso, somarDias, relogioLocal, instanteDoRelogio, dataComDia, nomeDoDia, diasEntre } from './tempo.js'

describe('fuso de Brasília', () => {
  it('lê data e hora de Brasília de um instante UTC, inclusive na virada do dia', () => {
    const instante = new Date('2026-10-31T01:30:00Z')
    expect(dataNoFuso(instante)).toBe('2026-10-30')
    expect(horaNoFuso(instante)).toBe('22:30')
  })

  it('acha o instante de uma hora de Brasília', () => {
    expect(instanteNoFuso('2026-11-05', '14:00').toISOString()).toBe('2026-11-05T17:00:00.000Z')
    expect(instanteNoFuso('2026-11-05').toISOString()).toBe('2026-11-05T03:00:00.000Z')
  })

  it('o relógio local mostra a hora de Brasília, e volta para o mesmo instante', () => {
    const instante = new Date('2026-10-30T17:45:00Z')
    const local = relogioLocal(instante)
    expect([local.getDate(), local.getHours(), local.getMinutes()]).toEqual([30, 14, 45])
    expect(instanteDoRelogio(local).toISOString()).toBe(instante.toISOString())
  })

  it('datas com o dia da semana, somas e diferenças', () => {
    expect(dataComDia('2026-10-30')).toBe('sex. 30/10/2026')
    expect(dataComDia('2026-11-01', { ano: false })).toBe('dom. 01/11')
    expect(nomeDoDia('2026-10-31')).toBe('sábado')
    expect(somarDias('2026-10-31', 1)).toBe('2026-11-01')
    expect(diasEntre('2026-10-10', '2026-10-30')).toBe(20)
  })
})
