import { describe, expect, it } from 'vitest'
import { normalizarConfigDeAvisos, minutosDeAviso, avisosDevidos, textoDoAviso, podarAvisados, avisosParaOServidor } from './lembretes.js'

const agora = new Date('2026-10-06T13:52:00-03:00')
const ev = (id, inicio, extra = {}) => ({
  id,
  summary: `Evento ${id}`,
  start: { dateTime: inicio },
  end: { dateTime: new Date(new Date(inicio).getTime() + 3600000).toISOString() },
  ...extra,
})

describe('normalizarConfigDeAvisos', () => {
  it('começa desligado, 10 min, e recusa valor estranho', () => {
    expect(normalizarConfigDeAvisos(null)).toEqual({ ativo: false, antecedencia: 10 })
    expect(normalizarConfigDeAvisos({ ativo: true, antecedencia: 7 })).toEqual({ ativo: true, antecedencia: 10 })
    expect(normalizarConfigDeAvisos({ ativo: true, antecedencia: 'google' })).toEqual({ ativo: true, antecedencia: 'google' })
  })
})

describe('minutosDeAviso', () => {
  it('no modo Google segue os pop-ups do evento ou da agenda', () => {
    const padrao = [{ method: 'popup', minutes: 10 }, { method: 'email', minutes: 60 }]
    expect(minutosDeAviso({ reminders: { useDefault: true }, calendarDefaultReminders: padrao }, 'google')).toEqual([10])
    expect(minutosDeAviso({ reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }, { method: 'popup', minutes: 5 }] } }, 'google')).toEqual([30, 5])
    expect(minutosDeAviso({ reminders: { useDefault: false } }, 'google')).toEqual([])
    expect(minutosDeAviso({}, 15)).toEqual([15])
  })
})

describe('avisosDevidos', () => {
  it('avisa só o que entrou na janela e ainda não começou', () => {
    const lista = [
      ev('perto', '2026-10-06T14:00:00-03:00'), // faltam 8 min
      ev('longe', '2026-10-06T15:00:00-03:00'),
      ev('comecou', '2026-10-06T13:30:00-03:00'),
      { id: 'diaInteiro', start: { date: '2026-10-06' }, end: { date: '2026-10-07' } },
      ev('cancelado', '2026-10-06T13:55:00-03:00', { status: 'cancelled' }),
    ]
    expect(avisosDevidos(lista, agora, { antecedencia: 10 }).map((a) => a.event.id)).toEqual(['perto'])
  })

  it('não repete o que já foi avisado e respeita a agenda desligada', () => {
    const e = ev('perto', '2026-10-06T14:00:00-03:00')
    const [a] = avisosDevidos([e], agora, { antecedencia: 10 })
    expect(avisosDevidos([e], agora, { antecedencia: 10, avisados: new Set(a.chaves) })).toEqual([])
    expect(avisosDevidos([e], agora, { antecedencia: 10, deveAvisar: () => false })).toEqual([])
  })

  it('dois lembretes vencidos juntos viram um aviso só', () => {
    const e = ev('x', '2026-10-06T14:00:00-03:00', { reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }, { method: 'popup', minutes: 10 }] } })
    const devidos = avisosDevidos([e], agora, { antecedencia: 'google' })
    expect(devidos).toHaveLength(1)
    expect(devidos[0].chaves).toHaveLength(2)
  })
})

describe('textoDoAviso', () => {
  it('diz quanto falta, o horário, o local e a agenda', () => {
    const t = textoDoAviso(ev('a', '2026-10-06T14:00:00-03:00', { location: 'CREAS', calendarSummary: 'AEPETI' }), agora)
    expect(t.titulo).toBe('Evento a')
    expect(t.corpo).toMatch(/^Em 8 min · /)
    expect(t.corpo).toContain('CREAS')
    expect(t.corpo).toContain('AEPETI')
  })
})

describe('podarAvisados', () => {
  it('esquece avisos de compromissos com mais de um dia', () => {
    const s = new Set(['a|2026-10-04T10:00:00.000Z|10', 'b|2026-10-06T17:00:00.000Z|10', 'lixo'])
    expect([...podarAvisados(s, agora)]).toEqual(['b|2026-10-06T17:00:00.000Z|10'])
  })
})

describe('avisosParaOServidor', () => {
  it('monta os avisos futuros já com hora e texto prontos', () => {
    const lista = [
      { id: 'r', summary: 'Reunião', location: 'CREAS', start: { dateTime: '2026-10-06T15:00:00-03:00' }, end: { dateTime: '2026-10-06T16:00:00-03:00' } },
      { id: 'passou', summary: 'Já passou o aviso', start: { dateTime: '2026-10-06T13:55:00-03:00' }, end: { dateTime: '2026-10-06T14:30:00-03:00' } },
      { id: 'dia', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } },
    ]
    const avisos = avisosParaOServidor(lista, agora, { antecedencia: 10 })
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatchObject({ titulo: 'Reunião', tag: 'compromisso-r', quando: new Date('2026-10-06T14:50:00-03:00').getTime() })
    expect(avisos[0].corpo).toMatch(/^Em 10 min · /)
    expect(avisos[0].corpo).toContain('CREAS')
  })

  it('respeita a agenda desligada', () => {
    const e = { id: 'r', start: { dateTime: '2026-10-06T15:00:00-03:00' }, end: { dateTime: '2026-10-06T16:00:00-03:00' } }
    expect(avisosParaOServidor([e], agora, { antecedencia: 10, deveAvisar: () => false })).toEqual([])
  })
})
