import { describe, expect, it } from 'vitest'
import { ultimoHorarioDaVarredura } from './useNotes.js'

function em(dataHora) {
  return new Date(`2026-09-17T${dataHora}`)
}

describe('ultimoHorarioDaVarredura', () => {
  it('acha o horário mais recente que já passou hoje', () => {
    expect(ultimoHorarioDaVarredura(em('09:30:00'))).toEqual(em('08:00:00'))
    expect(ultimoHorarioDaVarredura(em('14:00:00'))).toEqual(em('13:00:00'))
    expect(ultimoHorarioDaVarredura(em('23:59:00'))).toEqual(em('15:00:00'))
  })

  it('cai exatamente num horário quando é ele mesmo', () => {
    expect(ultimoHorarioDaVarredura(em('13:00:00'))).toEqual(em('13:00:00'))
  })

  it('antes do primeiro horário do dia, usa o último horário de ontem', () => {
    const resultado = ultimoHorarioDaVarredura(em('05:00:00'))
    expect(resultado.getDate()).toBe(16)
    expect(resultado.getHours()).toBe(15)
  })
})
