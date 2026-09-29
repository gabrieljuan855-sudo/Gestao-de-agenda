import { describe, expect, it } from 'vitest'
import { acharAgendaNoTexto, findDefaultCalendar } from './defaults.js'

const agendas = [
  { id: 'c1', summary: 'CREAS' },
  { id: 'c2', summary: 'AEPETI' },
  { id: 'c3', summary: 'Pessoal', summaryOverride: 'Família Gaúcha' },
  { id: 'c4', summary: 'CREAS Norte' },
]

describe('acharAgendaNoTexto', () => {
  it('acha a agenda citada no texto, sem caixa nem acento', () => {
    expect(acharAgendaNoTexto('Imersão AEPETI 22/10 dia inteiro', agendas)?.id).toBe('c2')
    expect(acharAgendaNoTexto('almoço familia gaucha domingo 12h', agendas)?.id).toBe('c3')
  })

  it('prefere o nome mais específico quando dois casam', () => {
    expect(acharAgendaNoTexto('Reunião CREAS Norte sexta 9h', agendas)?.id).toBe('c4')
    expect(acharAgendaNoTexto('Reunião CREAS sexta 9h', agendas)?.id).toBe('c1')
  })

  it('só casa palavra inteira, e sem nome no texto não escolhe nada', () => {
    expect(acharAgendaNoTexto('Reunião creasnorte', agendas)).toBe(null)
    expect(acharAgendaNoTexto('Dentista 14h', agendas)).toBe(null)
    expect(acharAgendaNoTexto('Dentista', [])).toBe(null)
  })
})

describe('findDefaultCalendar', () => {
  it('continua achando a agenda do CREAS como padrão', () => {
    expect(findDefaultCalendar(agendas)?.id).toBe('c1')
  })
})
