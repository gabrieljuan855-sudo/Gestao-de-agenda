import { describe, expect, it } from 'vitest'
import { pausaAtiva, duracaoDaPausa } from './aiCooldown.js'

const MINUTO = 60 * 1000

describe('duracaoDaPausa', () => {
  it('segura muito mais tempo quando foi a cota que estourou', () => {
    // A diferença que importa: sobrecarga passa em segundos, cota estourada
    // espera a próxima janela de cobrança. Insistir num limite de cota é
    // justamente o que mantinha o limite estourado.
    expect(duracaoDaPausa('limite')).toBe(60 * MINUTO)
    expect(duracaoDaPausa('sobrecarga')).toBe(5 * MINUTO)
  })

  it('não pausa nada por um erro comum', () => {
    // Worker fora do ar, rede caindo: não é cota, não tem por que segurar.
    expect(duracaoDaPausa('')).toBe(0)
    expect(duracaoDaPausa(undefined)).toBe(0)
    expect(duracaoDaPausa('qualquer_outra_coisa')).toBe(0)
  })
})

describe('pausaAtiva', () => {
  const agora = new Date('2026-09-17T12:00:00Z').getTime()

  it('vale enquanto o prazo não passou', () => {
    expect(pausaAtiva(new Date(agora + 10 * MINUTO).toISOString(), agora)).toBe(true)
  })

  it('libera assim que o prazo passa', () => {
    expect(pausaAtiva(new Date(agora - 1).toISOString(), agora)).toBe(false)
    expect(pausaAtiva(new Date(agora - 10 * MINUTO).toISOString(), agora)).toBe(false)
  })

  it('sem pausa gravada, nada é segurado', () => {
    expect(pausaAtiva(null, agora)).toBe(false)
    expect(pausaAtiva(undefined, agora)).toBe(false)
    expect(pausaAtiva('', agora)).toBe(false)
  })

  it('valor corrompido não trava a IA para sempre', () => {
    // Se o localStorage tiver lixo, o certo é liberar — o app sem IA por
    // tempo indeterminado seria pior que uma chamada a mais.
    expect(pausaAtiva('isso não é uma data', agora)).toBe(false)
  })
})
