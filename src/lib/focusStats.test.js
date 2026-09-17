import { describe, expect, it } from 'vitest'
import { combinedFocusStats, focusStatsFromEvents, FOCUS_TASK_PROP } from './focusStats.js'

function fociEvento(taskId, minutos) {
  const start = new Date('2026-09-01T10:00:00Z')
  const end = new Date(start.getTime() + minutos * 60000)
  return {
    extendedProperties: { private: { [FOCUS_TASK_PROP]: taskId } },
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  }
}

describe('focusStatsFromEvents', () => {
  it('conta só os blocos da tarefa pedida, somando os minutos', () => {
    const eventos = [fociEvento('t1', 25), fociEvento('t1', 25), fociEvento('t2', 25)]
    expect(focusStatsFromEvents(eventos, 't1')).toEqual({ sessions: 2, minutes: 50 })
  })

  it('devolve null quando a tarefa não tem nenhum bloco', () => {
    expect(focusStatsFromEvents([fociEvento('t2', 25)], 't1')).toBeNull()
    expect(focusStatsFromEvents([], 't1')).toBeNull()
  })

  it('ignora eventos comuns, sem a propriedade de foco', () => {
    const eventos = [{ start: { dateTime: '2026-09-01T10:00:00Z' }, end: { dateTime: '2026-09-01T11:00:00Z' } }]
    expect(focusStatsFromEvents(eventos, 't1')).toBeNull()
  })
})

describe('combinedFocusStats', () => {
  it('usa o que vier do Calendar quando não há nada no cache deste aparelho', () => {
    const eventos = [fociEvento('t1', 25), fociEvento('t1', 25)]
    expect(combinedFocusStats('t1', eventos)).toEqual({ sessions: 2, minutes: 50 })
  })

  it('sem nenhuma das duas fontes, não inventa estatística', () => {
    expect(combinedFocusStats('t1', [])).toBeNull()
  })
})
