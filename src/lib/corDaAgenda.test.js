import { describe, expect, it } from 'vitest'
import { corDaAgenda } from './corDaAgenda.js'

describe('corDaAgenda', () => {
  it('mistura a cor da agenda com o cartão, na força que o tema mandar', () => {
    expect(corDaAgenda('#4285f4')).toBe('color-mix(in srgb, #4285f4 var(--agenda-forca), var(--surface-container))')
  })

  it('sem cor da agenda, usa a reserva (sem misturar nada)', () => {
    expect(corDaAgenda(undefined)).toBe('var(--accent)')
    expect(corDaAgenda('', 'var(--border-strong)')).toBe('var(--border-strong)')
  })
})
