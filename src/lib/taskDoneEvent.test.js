import { describe, expect, it } from 'vitest'
import { montarEventoDeConclusao, TASK_DONE_PROP } from './taskDoneEvent.js'

const quando = new Date(2026, 8, 17, 14, 37)

describe('montarEventoDeConclusao', () => {
  it('é sempre de dia inteiro', () => {
    // O que está em jogo aqui não é estética: events.js só ignora o que é dia
    // inteiro ao calcular vãos livres, "agora/próximo" e carga do dia. Um
    // evento com hora faria os vãos livres encolherem a cada tarefa concluída,
    // além de inventar uma duração que não existiu.
    const evento = montarEventoDeConclusao({ id: 'x', title: 'Relatório' }, quando)
    expect(evento.allDay).toBe(true)
    expect(evento.start).toBe(quando)
    expect(evento.end).toBe(quando)
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
