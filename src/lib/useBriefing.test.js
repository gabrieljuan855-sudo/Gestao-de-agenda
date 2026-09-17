import { describe, expect, it } from 'vitest'
import { kindForSlot, deveAvisarDaFalha } from './useBriefing.js'

const MINUTO = 60 * 1000

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

describe('deveAvisarDaFalha', () => {
  it('cala a boca sobre sobrecarga passageira enquanto ainda dá tempo de tentar de novo', () => {
    // O caso real: 529 da Anthropic logo depois das 8h. A varredura tenta de novo
    // em 5 minutos e quase sempre passa — alarmar aqui é assustar a pessoa com
    // algo que já está sendo tratado e sobre o qual ela não pode fazer nada.
    expect(deveAvisarDaFalha({ transiente: true, msDesdeOAlvo: 0 })).toBe(false)
    expect(deveAvisarDaFalha({ transiente: true, msDesdeOAlvo: 30 * MINUTO })).toBe(false)
  })

  it('avisa sobre sobrecarga quando já não sobra tempo para outra tentativa', () => {
    // Perto do fim da janela de 90min não vem outra checagem dentro do prazo:
    // aí o briefing realmente não vai sair, e vale dizer.
    expect(deveAvisarDaFalha({ transiente: true, msDesdeOAlvo: 86 * MINUTO })).toBe(true)
    expect(deveAvisarDaFalha({ transiente: true, msDesdeOAlvo: 90 * MINUTO })).toBe(true)
  })

  it('avisa na hora sobre erro que não se resolve sozinho', () => {
    // Chave da Anthropic faltando, login vencido: tentar de novo não muda nada,
    // e a pessoa precisa saber para poder agir.
    expect(deveAvisarDaFalha({ transiente: false, msDesdeOAlvo: 0 })).toBe(true)
    expect(deveAvisarDaFalha({ transiente: undefined, msDesdeOAlvo: 0 })).toBe(true)
  })
})
