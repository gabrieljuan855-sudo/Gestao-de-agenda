import { describe, expect, it } from 'vitest'
import { inicioOriginal, ehPrimeiraDaSerie, horarioDaSerie, restanteDaContagem, corpoDaContinuacao } from './serieRecorrente.js'
import { PROJETO_PROP } from './projetos.js'

const serie = {
  id: 'serie',
  summary: 'Reunião',
  location: 'CREAS',
  attendees: [{ email: 'a@x.com' }],
  start: { dateTime: '2026-10-01T14:00:00-03:00', timeZone: 'America/Sao_Paulo' },
  end: { dateTime: '2026-10-01T15:00:00-03:00', timeZone: 'America/Sao_Paulo' },
  recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH'],
  extendedProperties: { private: { [PROJETO_PROP]: 'p1' } },
}
const ocorrencia = {
  id: 'serie_20261022T170000Z',
  recurringEventId: 'serie',
  originalStartTime: { dateTime: '2026-10-22T14:00:00-03:00' },
  start: { dateTime: '2026-10-22T14:00:00-03:00' },
  end: { dateTime: '2026-10-22T15:00:00-03:00' },
}

describe('ocorrência e série', () => {
  it('usa o horário original da ocorrência, mesmo se ela foi remarcada', () => {
    const remarcada = { ...ocorrencia, start: { dateTime: '2026-10-22T16:00:00-03:00' } }
    expect(inicioOriginal(remarcada).toISOString()).toBe('2026-10-22T17:00:00.000Z')
  })

  it('sabe quando a ocorrência é a primeira da série', () => {
    expect(ehPrimeiraDaSerie(serie, ocorrencia)).toBe(false)
    expect(ehPrimeiraDaSerie(serie, { ...ocorrencia, originalStartTime: serie.start })).toBe(true)
  })
})

describe('horarioDaSerie', () => {
  it('leva a mudança de horário para a série, cada uma no seu dia', () => {
    const h = horarioDaSerie(serie, ocorrencia, new Date('2026-10-22T15:00:00-03:00'), new Date('2026-10-22T16:30:00-03:00'))
    expect(h.start.toISOString()).toBe('2026-10-01T18:00:00.000Z')
    expect(h.end.toISOString()).toBe('2026-10-01T19:30:00.000Z')
  })

  it('sem mudança de horário, a série nem recebe start/end', () => {
    expect(horarioDaSerie(serie, ocorrencia, new Date('2026-10-22T14:00:00-03:00'), new Date('2026-10-22T15:00:00-03:00'))).toBeNull()
  })

  it('em dia inteiro, conta em dias', () => {
    const s = { start: { date: '2026-10-01' }, end: { date: '2026-10-02' } }
    const o = { start: { date: '2026-10-22' }, end: { date: '2026-10-23' } }
    const h = horarioDaSerie(s, o, new Date(2026, 9, 23), new Date(2026, 9, 24))
    expect([h.start.getDate(), h.end.getDate()]).toEqual([2, 3])
  })
})

describe('restanteDaContagem', () => {
  it('a continuação segue só com as vezes que faltam', () => {
    expect(restanteDaContagem(['RRULE:FREQ=DAILY;COUNT=10', 'EXDATE:x'], 4)).toEqual(['RRULE:FREQ=DAILY;COUNT=6', 'EXDATE:x'])
    expect(restanteDaContagem(['RRULE:FREQ=DAILY;COUNT=3'], 9)).toEqual(['RRULE:FREQ=DAILY;COUNT=1'])
  })
})

describe('corpoDaContinuacao', () => {
  const patch = {
    title: 'Reunião nova',
    start: new Date('2026-10-22T15:00:00-03:00'),
    end: new Date('2026-10-22T16:00:00-03:00'),
  }

  it('herda da série o que não foi mudado, e põe as mudanças por cima', () => {
    const { body, conferencia } = corpoDaContinuacao(serie, patch, ['RRULE:FREQ=WEEKLY;BYDAY=TH'])
    expect(body).toMatchObject({
      summary: 'Reunião nova',
      location: 'CREAS',
      attendees: [{ email: 'a@x.com' }],
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH'],
      start: { dateTime: '2026-10-22T18:00:00.000Z', timeZone: 'America/Sao_Paulo' },
      extendedProperties: { private: { [PROJETO_PROP]: 'p1' } },
    })
    expect(conferencia).toBe(false)
  })

  it('tirar do projeto e parar de repetir valem na continuação', () => {
    const { body } = corpoDaContinuacao(serie, { ...patch, projeto: '' }, [])
    expect(body.recurrence).toBeUndefined()
    expect(body.extendedProperties).toBeUndefined()
  })

  it('o Meet da série segue junto, a não ser que seja removido', () => {
    const comMeet = { ...serie, conferenceData: { conferenceId: 'abc', conferenceSolution: { key: { type: 'hangoutsMeet' } }, entryPoints: [] } }
    expect(corpoDaContinuacao(comMeet, patch, []).body.conferenceData.conferenceId).toBe('abc')
    expect(corpoDaContinuacao(comMeet, patch, []).conferencia).toBe(true)
    expect(corpoDaContinuacao(comMeet, { ...patch, removerVideochamada: true }, []).body.conferenceData).toBeUndefined()
  })
})
