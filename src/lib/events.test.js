import { describe, expect, it } from 'vitest'
import { startOfWeek } from './dates.js'
import { workBlocksFor } from './schedule.js'
import { eventsOfDay, findFreeGaps, findConflicts, tasksDueOn, eventStart, eventEnd } from './events.js'

// Segunda-feira de verdade (via startOfWeek), para não depender de saber de
// cabeça em que dia da semana cai uma data qualquer.
const monday = startOfWeek(new Date(2026, 8, 16))

function at(day, hh, mm) {
  const d = new Date(day)
  d.setHours(hh, mm, 0, 0)
  return d
}

function timed(id, hh1, mm1, hh2, mm2, calendarId = 'primary') {
  return {
    id,
    calendarId,
    start: { dateTime: at(monday, hh1, mm1).toISOString() },
    end: { dateTime: at(monday, hh2, mm2).toISOString() },
  }
}

describe('eventsOfDay', () => {
  it('só devolve eventos do dia pedido, em ordem de início', () => {
    const outroDia = new Date(monday)
    outroDia.setDate(outroDia.getDate() + 1)
    const events = [
      timed('tarde', 14, 0, 15, 0),
      timed('manha', 9, 0, 10, 0),
      { id: 'outro-dia', calendarId: 'primary', start: { dateTime: outroDia.toISOString() }, end: { dateTime: outroDia.toISOString() } },
    ]
    const result = eventsOfDay(events, monday)
    expect(result.map((e) => e.id)).toEqual(['manha', 'tarde'])
  })
})

describe('findFreeGaps', () => {
  it('encontra os vãos entre os compromissos dentro do expediente', () => {
    // Segunda: 08:00–12:00 e 13:00–17:30 (ver schedule.js).
    const events = [timed('reuniao', 9, 0, 10, 0)]
    const gaps = findFreeGaps(events, monday, workBlocksFor(monday), { occupies: () => true })
    expect(gaps).toHaveLength(3)
    expect(gaps[0].start.getHours()).toBe(8)
    expect(gaps[0].end.getHours()).toBe(9)
    expect(gaps[1].start.getHours()).toBe(10)
    expect(gaps[1].end.getHours()).toBe(12)
    expect(gaps[2].start.getHours()).toBe(13)
    expect(gaps[2].end.getHours()).toBe(17)
  })

  it('ignora compromissos que occupies() diz que não contam', () => {
    const events = [timed('informativo', 9, 0, 11, 0)]
    const gaps = findFreeGaps(events, monday, workBlocksFor(monday), { occupies: () => false })
    // Sem nada ocupando, o expediente inteiro vira um vão só por bloco.
    expect(gaps).toHaveLength(2)
  })

  it('descarta vãos menores que o mínimo', () => {
    const events = [timed('quase-tudo', 8, 10, 17, 30)]
    const gaps = findFreeGaps(events, monday, workBlocksFor(monday), { occupies: () => true, minMinutes: 30 })
    // Sobram só 10min de manhã e a pausa 12h-13h (60min) — o de 10min some.
    expect(gaps.every((g) => (g.end - g.start) / 60000 >= 30)).toBe(true)
  })
})

describe('findConflicts', () => {
  it('acha um par de compromissos de agendas diferentes que se cruzam', () => {
    const events = [timed('a', 9, 0, 10, 0, 'pessoal'), timed('b', 9, 30, 10, 30, 'gestao')]
    const conflicts = findConflicts(events, () => true)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].map((e) => e.id).sort()).toEqual(['a', 'b'])
  })

  it('não conta como conflito compromissos da mesma agenda', () => {
    const events = [timed('a', 9, 0, 10, 0, 'pessoal'), timed('b', 9, 30, 10, 30, 'pessoal')]
    expect(findConflicts(events, () => true)).toHaveLength(0)
  })

  it('não conta compromissos que não se tocam no tempo', () => {
    const events = [timed('a', 9, 0, 10, 0, 'pessoal'), timed('b', 10, 0, 11, 0, 'gestao')]
    expect(findConflicts(events, () => true)).toHaveLength(0)
  })

  it('ignora compromisso que occupies() diz que não ocupa tempo', () => {
    const events = [timed('a', 9, 0, 10, 0, 'pessoal'), timed('b', 9, 30, 10, 30, 'gestao')]
    expect(findConflicts(events, (e) => e.id !== 'b')).toHaveLength(0)
  })
})

describe('tasksDueOn', () => {
  it('acha tarefa com prazo no dia, sem se confundir com o fuso do Google (meia-noite UTC)', () => {
    // Formato real do Google Tasks: sempre T00:00:00.000Z. Em fuso negativo
    // (Brasil), `new Date(...)` direto mostraria um dia a menos — é
    // exatamente o bug que motivou dateOnlyFromISO.
    const tasks = [{ id: 't1', due: '2026-09-16T00:00:00.000Z', status: 'needsAction' }]
    const dia = new Date(2026, 8, 16)
    expect(tasksDueOn(tasks, dia).map((t) => t.id)).toEqual(['t1'])
  })

  it('não conta tarefa concluída nem sem prazo', () => {
    const dia = new Date(2026, 8, 16)
    const tasks = [
      { id: 'feita', due: '2026-09-16T00:00:00.000Z', status: 'completed' },
      { id: 'sem-prazo', status: 'needsAction' },
    ]
    expect(tasksDueOn(tasks, dia)).toHaveLength(0)
  })
})

describe('eventStart / eventEnd em evento de dia inteiro', () => {
  it('lê a data sem deslocar por fuso', () => {
    const event = { start: { date: '2026-09-16' }, end: { date: '2026-09-17' } }
    expect(eventStart(event).toDateString()).toBe(new Date(2026, 8, 16).toDateString())
    // O end.date do Google é exclusivo: evento de um dia só termina no
    // seguinte, então eventEnd volta um dia.
    expect(eventEnd(event).toDateString()).toBe(new Date(2026, 8, 16).toDateString())
  })
})
