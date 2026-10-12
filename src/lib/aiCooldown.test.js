import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pausaAtiva, duracaoDaPausa, pausarIA, cotaDoDiaPausadaAte, barrarSeCotaDoDiaAcabou, avisoDeCotaDoDia } from './aiCooldown.js'

const MINUTO = 60 * 1000

describe('duracaoDaPausa', () => {
  it('segura muito mais tempo quando foi a cota que estourou', () => {
    // A diferença que importa: sobrecarga passa em segundos, cota estourada
    // espera a próxima janela de cobrança. Insistir num limite de cota é
    // justamente o que mantinha o limite estourado.
    expect(duracaoDaPausa('limite')).toBe(60 * MINUTO)
    expect(duracaoDaPausa('sobrecarga')).toBe(5 * MINUTO)
    expect(duracaoDaPausa('dia')).toBe(60 * MINUTO)
    expect(duracaoDaPausa('minuto')).toBe(MINUTO)
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

describe('cota do dia', () => {
  const guardado = {}
  beforeEach(() => {
    for (const k of Object.keys(guardado)) delete guardado[k]
    vi.stubGlobal('localStorage', {
      getItem: (k) => guardado[k] ?? null,
      setItem: (k, v) => { guardado[k] = String(v) },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('cota diária esgotada barra o pedido sem sair do aparelho', () => {
    pausarIA('dia')
    expect(cotaDoDiaPausadaAte()).not.toBeNull()
    expect(() => barrarSeCotaDoDiaAcabou()).toThrow(/cota diária/)
    try {
      barrarSeCotaDoDiaAcabou()
    } catch (err) {
      expect(err.transiente).toBe(true)
    }
  })

  it('sobrecarga e limite por minuto não barram pedido feito à mão', () => {
    pausarIA('sobrecarga')
    pausarIA('minuto')
    expect(cotaDoDiaPausadaAte()).toBeNull()
    expect(() => barrarSeCotaDoDiaAcabou()).not.toThrow()
  })

  it('libera depois da pausa', () => {
    pausarIA('dia')
    expect(cotaDoDiaPausadaAte(Date.now() + 61 * MINUTO)).toBeNull()
  })

  it('o aviso diz até que horas', () => {
    expect(avisoDeCotaDoDia(new Date().toISOString())).toMatch(/\d{2}:\d{2}/)
  })
})
