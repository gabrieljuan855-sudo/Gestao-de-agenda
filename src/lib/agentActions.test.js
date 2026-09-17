import { describe, expect, it } from 'vitest'
import { resolverRef, buildEventPatch, buildTaskPatch } from './agentActions.js'

function evento({ start, end, allDay = false }) {
  return allDay
    ? { summary: 'Feriado', start: { date: start }, end: { date: end } }
    : { summary: 'Reunião', start: { dateTime: start }, end: { dateTime: end } }
}

describe('resolverRef', () => {
  const contexto = {
    eventos: [evento({ start: '2026-03-10T14:00:00-03:00', end: '2026-03-10T15:00:00-03:00' })],
    tarefas: [{ id: 'abc', title: 'Ligar para a Ana' }],
  }

  it('acha o item vivo por trás da referência curta', () => {
    expect(resolverRef('e1', contexto)).toEqual({ kind: 'event', item: contexto.eventos[0] })
    expect(resolverRef('t1', contexto)).toEqual({ kind: 'task', item: contexto.tarefas[0] })
  })

  it('devolve null quando a referência não existe mais — a ação fica órfã, não acerta o vizinho', () => {
    // O caso real: entre a IA propor e a pessoa aprovar, um reload mudou as
    // listas. Acertar o índice vizinho aqui apagaria o compromisso errado.
    expect(resolverRef('e9', contexto)).toBe(null)
    expect(resolverRef('t2', contexto)).toBe(null)
  })

  it('não aceita referência fora do formato', () => {
    expect(resolverRef('x1', contexto)).toBe(null)
    expect(resolverRef('e0', contexto)).toBe(null)
    expect(resolverRef('e', contexto)).toBe(null)
    expect(resolverRef(undefined, contexto)).toBe(null)
    expect(resolverRef(3, contexto)).toBe(null)
  })
})

describe('buildEventPatch', () => {
  it('mantém a duração original quando só a hora muda', () => {
    const e = evento({ start: '2026-03-10T14:00:00-03:00', end: '2026-03-10T15:30:00-03:00' })
    const patch = buildEventPatch(e, { time: '16:00' })
    expect((patch.end - patch.start) / 60000).toBe(90)
    expect(patch.start.getHours()).toBe(16)
  })

  it('usa a duração dita quando ela vem no comando', () => {
    const e = evento({ start: '2026-03-10T14:00:00-03:00', end: '2026-03-10T15:00:00-03:00' })
    const patch = buildEventPatch(e, { time: '09:00', durationMinutes: 30 })
    expect((patch.end - patch.start) / 60000).toBe(30)
  })

  it('preserva o dia inteiro', () => {
    const e = evento({ start: '2026-03-10', end: '2026-03-11', allDay: true })
    const patch = buildEventPatch(e, { date: '2026-03-12' })
    expect(patch.allDay).toBe(true)
  })

  it('não mexe em horário quando só o título muda', () => {
    const e = evento({ start: '2026-03-10T14:00:00-03:00', end: '2026-03-10T15:00:00-03:00' })
    const patch = buildEventPatch(e, { title: 'Outro nome' })
    expect(patch).toEqual({ title: 'Outro nome' })
  })
})

describe('buildTaskPatch', () => {
  it('omite os campos que a ação não tocou', () => {
    expect(buildTaskPatch({ title: 'Novo título' })).toEqual({
      title: 'Novo título',
      due: undefined,
      priority: undefined,
    })
  })

  it('converte a data do prazo', () => {
    const patch = buildTaskPatch({ date: '2026-03-12' })
    expect(patch.due).toBeInstanceOf(Date)
    expect(patch.title).toBe(undefined)
  })
})
