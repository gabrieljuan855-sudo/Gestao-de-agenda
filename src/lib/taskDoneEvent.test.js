import { describe, expect, it } from 'vitest'
import { montarEventoDeConclusao, ehRegistroDeConclusao, TASK_DONE_PROP } from './taskDoneEvent.js'
import { occupiesTime } from './calendarPrefs.js'

const quando = new Date(2026, 8, 17, 14, 37)

describe('montarEventoDeConclusao', () => {
  it('marca a hora em que a tarefa foi concluída, num bloco de 15 minutos', () => {
    const evento = montarEventoDeConclusao({ id: 'x', title: 'Relatório' }, quando)
    expect(evento.start).toBe(quando)
    expect((evento.end - evento.start) / 60000).toBe(15)
  })

  it('marca o título e guarda o id da tarefa para reconhecer depois', () => {
    const evento = montarEventoDeConclusao({ id: 'tarefa-1', title: 'Relatório' }, quando)
    expect(evento.title).toBe('✓ Relatório')
    expect(evento.extendedProperties.private[TASK_DONE_PROP]).toBe('tarefa-1')
  })

  it('leva prioridade e lista para a descrição, quando existem', () => {
    const evento = montarEventoDeConclusao(
      { id: 'x', title: 'Ligar para a Ana', priority: 'alta', tasklistTitle: 'Prioridade Alta' },
      quando
    )
    expect(evento.description).toContain('Prioridade: Alta')
    expect(evento.description).toContain('Lista: Prioridade Alta')
  })

  it('não inventa descrição para o que a tarefa não tem', () => {
    const evento = montarEventoDeConclusao({ id: 'x', title: 'Solta' }, quando)
    expect(evento.description).toBe('Concluída pelo Gestão de Agenda.')
  })

  it('não quebra com uma tarefa sem título nem id', () => {
    const evento = montarEventoDeConclusao({}, quando)
    expect(evento.title).toBe('✓ (sem título)')
    expect(evento.extendedProperties).toBe(undefined)
  })
})

describe('ehRegistroDeConclusao', () => {
  it('reconhece pela marca, não pelo título', () => {
    // O título pode ser reescrito no Google Calendar; a marca, não.
    const registro = montarEventoDeConclusao({ id: 'x', title: 'Relatório' }, quando)
    expect(ehRegistroDeConclusao(registro)).toBe(true)
    expect(ehRegistroDeConclusao({ summary: '✓ Relatório' })).toBe(false)
    expect(ehRegistroDeConclusao({})).toBe(false)
    expect(ehRegistroDeConclusao(undefined)).toBe(false)
  })
})

describe('registro de conclusão e a conta de ocupação', () => {
  it('não conta como tempo ocupado, mesmo tendo hora', () => {
    // O ponto do PR: o registro aparece na grade do dia, mas concluir seis
    // tarefas numa tarde não pode carimbar uma hora e meia de "ocupado" que
    // nunca existiu, nem picotar os vãos livres.
    const registro = { ...montarEventoDeConclusao({ id: 'x', title: 'X' }, quando), calendarId: 'primary' }
    expect(occupiesTime(registro, {}, {})).toBe(false)
  })

  it('um compromisso comum na mesma agenda continua ocupando', () => {
    expect(occupiesTime({ calendarId: 'primary' }, {}, {})).toBe(true)
  })
})
