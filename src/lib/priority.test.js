import { describe, expect, it } from 'vitest'
import { priorityFromListTitle, normalizePriority } from './priority.js'

describe('priorityFromListTitle', () => {
  it('lê a prioridade de nomes reais de lista do Google Tasks', () => {
    expect(priorityFromListTitle('Prioridade Máxima (menos de uma semana)')).toBe('alta')
    expect(priorityFromListTitle('Prioridade Média (intermediária)')).toBe('media')
    expect(priorityFromListTitle('Prioridade Baixa')).toBe('baixa')
  })

  it('ignora acento e caixa', () => {
    expect(priorityFromListTitle('PRIORIDADE URGENTE')).toBe('alta')
  })

  it('devolve null para uma lista sem "prioridade" no nome', () => {
    expect(priorityFromListTitle('Minhas tarefas')).toBe(null)
    expect(priorityFromListTitle('')).toBe(null)
    expect(priorityFromListTitle(null)).toBe(null)
  })
})

describe('normalizePriority', () => {
  it('aceita os três valores atuais', () => {
    expect(normalizePriority('alta')).toBe('alta')
    expect(normalizePriority('MEDIA')).toBe('media')
    expect(normalizePriority('baixa')).toBe('baixa')
  })

  it('traduz as tags antigas (urgente/importante/pode_esperar)', () => {
    expect(normalizePriority('urgente')).toBe('alta')
    expect(normalizePriority('importante')).toBe('media')
    expect(normalizePriority('pode_esperar')).toBe('baixa')
  })

  it('devolve null para valor desconhecido ou vazio', () => {
    expect(normalizePriority('')).toBe(null)
    expect(normalizePriority(null)).toBe(null)
    expect(normalizePriority('urgentissimo')).toBe(null)
  })
})
