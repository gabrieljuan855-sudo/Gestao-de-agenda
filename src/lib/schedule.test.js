import { describe, it, expect, beforeEach, vi } from 'vitest'
import { horarioPadrao, loadWorkSchedule, saveWorkSchedule, workBlocksFor, isWorkday } from './schedule.js'

function fakeLocalStorage() {
  let store = {}
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
    clear: () => { store = {} },
  }
}

describe('schedule', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeLocalStorage())
  })

  it('sem nada salvo, carrega o padrão de fábrica', () => {
    expect(loadWorkSchedule()).toEqual(horarioPadrao())
  })

  it('guarda e recarrega uma preferência própria', () => {
    const meu = { 1: [['09:00', '18:00']] }
    saveWorkSchedule(meu)
    expect(loadWorkSchedule()).toEqual(meu)
  })

  it('workBlocksFor usa o horário salvo, não o padrão', () => {
    saveWorkSchedule({ 1: [['09:00', '10:00']] })
    const segunda = new Date('2026-09-21T12:00:00') // segunda-feira
    const blocos = workBlocksFor(segunda)
    expect(blocos).toHaveLength(1)
    expect(blocos[0].start.getHours()).toBe(9)
    expect(blocos[0].end.getHours()).toBe(10)
  })

  it('domingo sem expediente configurado não é dia útil', () => {
    const domingo = new Date('2026-09-20T12:00:00')
    expect(isWorkday(domingo)).toBe(false)
  })

  it('localStorage indisponível cai no padrão sem quebrar', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadWorkSchedule()).toEqual(horarioPadrao())
  })
})
