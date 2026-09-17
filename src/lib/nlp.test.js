import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from './nlp.js'

const ref = new Date(2026, 8, 1) // 1º de setembro de 2026, fixo para o teste não depender do dia em que roda

describe('parseQuickAdd', () => {
  it('data + hora no formato compacto brasileiro ("14h") vira evento', () => {
    const r = parseQuickAdd('Reunião de equipe 20/09/2026 14h', ref)
    expect(r.type).toBe('event')
    expect(r.title).toBe('Reunião de equipe')
    expect(r.start.getFullYear()).toBe(2026)
    expect(r.start.getMonth()).toBe(8)
    expect(r.start.getDate()).toBe(20)
    expect(r.start.getHours()).toBe(14)
  })

  it('"por Nmin" define a duração e não vira horário', () => {
    const r = parseQuickAdd('Reunião de equipe 20/09/2026 14h por 40min', ref)
    expect(r.durationMinutes).toBe(40)
    expect((r.end - r.start) / 60000).toBe(40)
  })

  it('"dia N" sem mês vira uma data no mês atual (ou no seguinte, se o dia já passou)', () => {
    const r = parseQuickAdd('Pagar conta dia 20', ref)
    expect(r.type).toBe('task')
    expect(r.due.getFullYear()).toBe(2026)
    expect(r.due.getMonth()).toBe(8)
    expect(r.due.getDate()).toBe(20)
  })

  it('sem nenhuma data reconhecida, vira tarefa sem prazo', () => {
    const r = parseQuickAdd('Comprar café para o escritório', ref)
    expect(r.type).toBe('task')
    expect(r.due).toBe(null)
  })

  it('detecta prioridade alta por palavra de urgência, e tira a palavra do título', () => {
    const r = parseQuickAdd('Comprar pão urgente', ref)
    expect(r.priority).toBe('alta')
    expect(r.title).toBe('Comprar pão')
  })

  it('detecta prioridade média por prazo/importância', () => {
    const r = parseQuickAdd('Entregar relatório importante', ref)
    expect(r.priority).toBe('media')
  })

  it('sem palavra de urgência, prioridade fica null (quem decide o padrão é o formulário)', () => {
    const r = parseQuickAdd('Organizar a mesa', ref)
    expect(r.priority).toBe(null)
  })
})
