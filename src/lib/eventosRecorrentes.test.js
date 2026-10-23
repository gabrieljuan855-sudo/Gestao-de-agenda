import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./googleAuth.js', () => ({
  ensureToken: async () => 'token',
  refreshAfterUnauthorized: async () => null,
}))

const { salvarEvento, excluirEvento } = await import('./googleApi.js')

// O que cada escopo manda para o Google, chamada por chamada. É a parte que
// mexe na agenda de verdade e não dá para conferir aqui sem a conta.
const serie = {
  id: 'serie',
  summary: 'Reunião',
  start: { dateTime: '2026-10-01T17:00:00Z' },
  end: { dateTime: '2026-10-01T18:00:00Z' },
  recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=10'],
}
const ocorrencia = {
  id: 'serie_20261022T170000Z',
  calendarId: 'agenda',
  recurringEventId: 'serie',
  originalStartTime: { dateTime: '2026-10-22T17:00:00Z' },
  start: { dateTime: '2026-10-22T17:00:00Z' },
  end: { dateTime: '2026-10-22T18:00:00Z' },
}
const patch = {
  title: 'Reunião',
  start: new Date('2026-10-22T18:00:00Z'),
  end: new Date('2026-10-22T19:00:00Z'),
  allDay: false,
  calendarId: 'agenda',
  recorrenciaEscolhida: false,
}

let chamadas
beforeEach(() => {
  chamadas = []
  globalThis.fetch = vi.fn(async (url, opcoes = {}) => {
    const metodo = opcoes.method || 'GET'
    chamadas.push({ metodo, url: decodeURIComponent(url), body: opcoes.body ? JSON.parse(opcoes.body) : undefined })
    let dados = { id: 'novo' }
    if (metodo === 'GET' && url.includes('/instances')) dados = { items: [{}, {}, {}] }
    else if (metodo === 'GET') dados = serie
    return { ok: true, status: metodo === 'DELETE' ? 204 : 200, json: async () => dados, text: async () => '' }
  })
})

const resumo = () => chamadas.map((c) => `${c.metodo} ${c.url.replace('https://www.googleapis.com/calendar/v3', '').split('?')[0]}`)

describe('salvarEvento', () => {
  it('"este evento" mexe só na ocorrência, sem regra', async () => {
    await salvarEvento(ocorrencia, { ...patch, recurrence: ['RRULE:FREQ=DAILY'] }, 'este')
    expect(resumo()).toEqual(['PATCH /calendars/agenda/events/serie_20261022T170000Z'])
    expect(chamadas[0].body.recurrence).toBeUndefined()
  })

  it('"todos" muda a série, levando o novo horário para o dia da série', async () => {
    await salvarEvento(ocorrencia, patch, 'todos')
    expect(resumo()).toEqual(['GET /calendars/agenda/events/serie', 'PATCH /calendars/agenda/events/serie'])
    expect(chamadas[1].body.start).toEqual({ dateTime: '2026-10-01T18:00:00.000Z' })
  })

  it('"este e os seguintes" cria a continuação e só então corta a série', async () => {
    await salvarEvento(ocorrencia, patch, 'seguintes')
    expect(resumo()).toEqual([
      'GET /calendars/agenda/events/serie',
      'GET /calendars/agenda/events/serie/instances',
      'POST /calendars/agenda/events',
      'PATCH /calendars/agenda/events/serie',
    ])
    // Três já aconteceram, então a continuação fica com as sete restantes.
    expect(chamadas[2].body.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=7'])
    expect(chamadas[3].body.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261022T165959Z'])
  })

  it('se cortar a série falhar, desfaz a continuação', async () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, opcoes = {}) => {
      if (opcoes.method === 'PATCH') {
        chamadas.push({ metodo: 'PATCH', url: decodeURIComponent(url) })
        return { ok: false, status: 500, text: async () => 'erro' }
      }
      return original(url, opcoes)
    })
    await expect(salvarEvento(ocorrencia, patch, 'seguintes')).rejects.toThrow()
    expect(resumo().at(-1)).toBe('DELETE /calendars/agenda/events/novo')
  })
})

describe('excluirEvento', () => {
  it('"este evento" exclui só a ocorrência', async () => {
    await excluirEvento(ocorrencia, 'este')
    expect(resumo()).toEqual(['DELETE /calendars/agenda/events/serie_20261022T170000Z'])
  })

  it('"todos" exclui a série', async () => {
    await excluirEvento(ocorrencia, 'todos')
    expect(resumo()).toEqual(['GET /calendars/agenda/events/serie', 'DELETE /calendars/agenda/events/serie'])
  })

  it('"este e os seguintes" encerra a série antes desta', async () => {
    await excluirEvento(ocorrencia, 'seguintes')
    expect(resumo()).toEqual(['GET /calendars/agenda/events/serie', 'PATCH /calendars/agenda/events/serie'])
    expect(chamadas[1].body.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261022T165959Z'])
  })

  it('"este e os seguintes" na primeira ocorrência é a série inteira', async () => {
    await excluirEvento({ ...ocorrencia, originalStartTime: serie.start }, 'seguintes')
    expect(resumo()).toEqual(['GET /calendars/agenda/events/serie', 'DELETE /calendars/agenda/events/serie'])
  })
})
