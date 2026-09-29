import { describe, expect, it } from 'vitest'
import { parseQuickAdd, decidirDestino, descreverQuando } from './nlp.js'

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

  it('"hoje" não é urgência sozinho — só o dia batendo com hoje não é o mesmo que urgente', () => {
    const r = parseQuickAdd('Reunião hoje às 15h com o fornecedor', ref)
    expect(r.priority).not.toBe('alta')
  })

  it('"de Nh" sem minutos é horário, não duração — "reunião de 9h" quer dizer "às 9h"', () => {
    const r = parseQuickAdd('Reunião de 9h amanhã', ref)
    expect(r.type).toBe('event')
    expect(r.start.getHours()).toBe(9)
  })

  it('"de NhMM", com os minutos escritos, continua sendo duração', () => {
    const r = parseQuickAdd('Reunião 20/09/2026 14h de 1h30', ref)
    expect(r.durationMinutes).toBe(90)
  })

  it('não apaga o verbo/substantivo do título por ele também marcar prioridade', () => {
    const r = parseQuickAdd('Entregar relatório até sexta-feira', ref)
    expect(r.title).toBe('Entregar relatório')
    expect(r.priority).toBe('media')

    const r2 = parseQuickAdd('Prazo do projeto amanhã', ref)
    expect(r2.title).toBe('Prazo do projeto')
  })

  it('@contexto e #projeto escritos no texto viram campos, e saem do título', () => {
    const r = parseQuickAdd('Ligar pro banco @carro #financas', ref)
    expect(r.type).toBe('task')
    expect(r.contexto).toBe('carro')
    expect(r.projeto).toBe('financas')
    expect(r.title).toBe('Ligar pro banco')
  })

  it('a etiqueta usa a mesma normalização de gtd.js (sem acento, minúscula)', () => {
    const r = parseQuickAdd('Revisar contrato @Advogado #Caso-Maria', ref)
    expect(r.contexto).toBe('advogado')
    expect(r.projeto).toBe('caso-maria')
  })

  it('tag também funciona junto com data e hora (evento)', () => {
    const r = parseQuickAdd('Reunião 20/09/2026 14h @trabalho', ref)
    expect(r.type).toBe('event')
    expect(r.title).toBe('Reunião')
  })
})

describe('decidirDestino', () => {
  it('compromisso (dia e hora certos) vai direto para a agenda', () => {
    const r = parseQuickAdd('Dentista 20/09/2026 14h', ref)
    expect(decidirDestino(r)).toBe('evento')
  })

  it('tarefa com prazo vai direto para Próximas ações', () => {
    const r = parseQuickAdd('Pagar conta dia 20', ref)
    expect(decidirDestino(r)).toBe('tarefa')
  })

  it('tarefa com prioridade explícita vai direto para Próximas ações', () => {
    const r = parseQuickAdd('Ligar urgente', ref)
    expect(decidirDestino(r)).toBe('tarefa')
  })

  it('tarefa com @contexto ou #projeto vai direto para Próximas ações', () => {
    const r = parseQuickAdd('Revisar contrato @advogado', ref)
    expect(decidirDestino(r)).toBe('tarefa')
  })

  it('pensamento cru, sem nenhum sinal, vai para a Entrada', () => {
    const r = parseQuickAdd('Comprar café para o escritório', ref)
    expect(decidirDestino(r)).toBe('entrada')
  })

  it('sem preview nenhum (campo vazio), vai para a Entrada', () => {
    expect(decidirDestino(null)).toBe('entrada')
  })
})

describe('parseQuickAdd — recorrência', () => {
  it('"toda segunda 14h" marca recorrência semanal e mantém "segunda" fora do título', () => {
    const r = parseQuickAdd('Reunião de equipe toda segunda 14h', ref)
    expect(r.type).toBe('event')
    expect(r.recorrencia).toBe('semanal')
    expect(r.title).toBe('Reunião de equipe')
  })

  it('"todos os dias" marca diária e some do título por completo', () => {
    const r = parseQuickAdd('Alongamento todos os dias 7h', ref)
    expect(r.recorrencia).toBe('diaria')
    expect(r.title).toBe('Alongamento')
  })

  it('"todo mês" marca mensal e some do título', () => {
    const r = parseQuickAdd('Pagar aluguel todo mês dia 5 10h', ref)
    expect(r.recorrencia).toBe('mensal')
    expect(r.title).toBe('Pagar aluguel')
  })

  it('sem nenhuma frase de repetição, recorrencia fica null', () => {
    const r = parseQuickAdd('Dentista amanhã 14h', ref)
    expect(r.recorrencia).toBe(null)
  })
})

describe('parseQuickAdd — dia inteiro e vários dias', () => {
  const hoje = new Date(2026, 8, 29) // terça, 29/09/2026
  const dia = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()]

  it('"dia inteiro" com data vira compromisso de dia inteiro, não tarefa com prazo', () => {
    const r = parseQuickAdd('Treinamento 22/10 dia inteiro', hoje)
    expect(r).toMatchObject({ type: 'event', allDay: true, title: 'Treinamento' })
    expect(dia(r.start)).toEqual([2026, 10, 22])
    expect(dia(r.end)).toEqual([2026, 10, 22])
    expect(decidirDestino(r)).toBe('evento')
  })

  it('"todo o dia" não vira repetição diária', () => {
    const r = parseQuickAdd('Mutirão todo o dia 15/10', hoje)
    expect(r.allDay).toBe(true)
    expect(r.recorrencia).toBe(null)
  })

  it('"dia inteiro" sem data vale para hoje', () => {
    const r = parseQuickAdd('Home office dia inteiro', hoje)
    expect(dia(r.start)).toEqual([2026, 9, 29])
  })

  it.each([
    ['Férias de 20/10 a 31/10', 'Férias', [2026, 10, 20], [2026, 10, 31]],
    ['Congresso 22 a 24/10', 'Congresso', [2026, 10, 22], [2026, 10, 24]],
    ['Feriado prolongado 20-31/10', 'Feriado prolongado', [2026, 10, 20], [2026, 10, 31]],
    ['Viagem 22 a 24 de outubro', 'Viagem', [2026, 10, 22], [2026, 10, 24]],
    ['Curso de 22/10 até 24/10', 'Curso', [2026, 10, 22], [2026, 10, 24]],
    ['Recesso 30/12 a 02/01', 'Recesso', [2026, 12, 30], [2027, 1, 2]],
  ])('período "%s" vira um compromisso de vários dias', (texto, titulo, inicio, fim) => {
    const r = parseQuickAdd(texto, hoje)
    expect(r).toMatchObject({ type: 'event', allDay: true, title: titulo })
    expect(dia(r.start)).toEqual(inicio)
    expect(dia(r.end)).toEqual(fim)
  })

  it('"de segunda a quarta" nunca termina antes de começar', () => {
    const r = parseQuickAdd('Plantão de segunda a quarta', hoje)
    expect(r.allDay).toBe(true)
    expect(r.end >= r.start).toBe(true)
    expect(r.start.getDay()).toBe(1)
    expect(r.end.getDay()).toBe(3)
    expect((r.end - r.start) / 86400000).toBe(2)
  })

  it('data com hora continua sendo compromisso com horário, e data sozinha continua prazo', () => {
    expect(parseQuickAdd('Reunião 22/10 14h', hoje).allDay).toBeUndefined()
    expect(parseQuickAdd('Pagar conta dia 20', hoje).type).toBe('task')
    expect(parseQuickAdd('Entregar relatório até sexta', hoje).type).toBe('task')
  })
})

describe('descreverQuando', () => {
  it('diz o horário, o dia inteiro ou o período', () => {
    const hoje = new Date(2026, 8, 29)
    expect(descreverQuando(parseQuickAdd('Reunião 22/10 14h', hoje))).toBe('22/10 às 14:00')
    expect(descreverQuando(parseQuickAdd('Treinamento 22/10 dia inteiro', hoje))).toBe('22/10, dia inteiro')
    expect(descreverQuando(parseQuickAdd('Congresso 22 a 24/10', hoje))).toBe('de 22/10 a 24/10 (3 dias)')
  })
})
