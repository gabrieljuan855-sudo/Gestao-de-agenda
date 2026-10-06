import { describe, expect, it } from 'vitest'
import { descreverUltimaRevisao, revisaoAtrasada, textoDaRevisao } from './revisaoRegistro.js'

const agora = new Date(2026, 9, 6, 15)

describe('última revisão', () => {
  it('descreve hoje, ontem, há N dias e nunca', () => {
    expect(descreverUltimaRevisao(new Date(2026, 9, 6, 9).toISOString(), agora)).toBe('Última revisão: hoje.')
    expect(descreverUltimaRevisao(new Date(2026, 9, 5, 22).toISOString(), agora)).toBe('Última revisão: ontem.')
    expect(descreverUltimaRevisao(new Date(2026, 8, 27).toISOString(), agora)).toBe('Última revisão: há 9 dias.')
    expect(descreverUltimaRevisao(null, agora)).toMatch(/Nenhuma/)
  })

  it('está atrasada a partir de uma semana, ou quando nunca houve', () => {
    expect(revisaoAtrasada(null, agora)).toBe(true)
    expect(revisaoAtrasada(new Date(2026, 8, 29).toISOString(), agora)).toBe(true)
    expect(revisaoAtrasada(new Date(2026, 9, 1).toISOString(), agora)).toBe(false)
  })
})

describe('textoDaRevisao', () => {
  it('monta o registro com números, decisões e comentário', () => {
    const r = textoDaRevisao(
      {
        numeros: { concluidasNaSemana: 5, atrasadas: 1, paradas: 2, blocosDeFoco: 3, minutosDeFoco: 75, projetosParados: ['app'] },
        comentario: 'Boa semana.',
        decisoes: ['Remarcada: "Ligar cartório"'],
      },
      agora
    )
    expect(r.title).toBe('Revisão de 06/10')
    expect(r.body).toContain('- Concluídas: 5')
    expect(r.body).toContain('- Projetos sem próxima ação: app')
    expect(r.body).toContain('Remarcada: "Ligar cartório"')
    expect(r.body).toContain('Boa semana.')
  })
})
