import { describe, expect, it } from 'vitest'
import { medidasReduzidas } from './imagemReduzida.js'

describe('medidasReduzidas', () => {
  it('leva o lado maior a 1024 mantendo a proporção, em pé ou deitada', () => {
    expect(medidasReduzidas(4032, 3024)).toEqual({ largura: 1024, altura: 768 })
    expect(medidasReduzidas(3024, 4032)).toEqual({ largura: 768, altura: 1024 })
  })

  it('não aumenta imagem pequena e recusa medida inválida', () => {
    expect(medidasReduzidas(800, 600)).toEqual({ largura: 800, altura: 600 })
    expect(medidasReduzidas(0, 600)).toBeNull()
  })
})
