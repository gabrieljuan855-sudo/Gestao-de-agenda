import { describe, expect, it } from 'vitest'
import { quantosCabem } from './capacidade.js'

describe('quantosCabem', () => {
  it('conta quantos itens cabem depois do espaço reservado', () => {
    expect(quantosCabem(200, { alturaItem: 18, reservado: 38 })).toBe(9)
  })

  it('nunca desce do mínimo nem passa do máximo', () => {
    expect(quantosCabem(40, { alturaItem: 18, reservado: 38, minimo: 3 })).toBe(3)
    expect(quantosCabem(2000, { alturaItem: 18, maximo: 12 })).toBe(12)
  })

  it('antes de medir (altura 0 ou inválida) fica no mínimo', () => {
    expect(quantosCabem(0, { alturaItem: 18, minimo: 6 })).toBe(6)
    expect(quantosCabem(NaN, { alturaItem: 18, minimo: 3 })).toBe(3)
  })
})
