import { describe, expect, it } from 'vitest'
import {
  construirRecorrencia,
  detectarRecorrencia,
  lerRecorrencia,
  montarRecorrencia,
  montarRRule,
  opcoesDeRepeticao,
  opcaoDaRegra,
  opcoesMensais,
  descreverRegra,
  acompanharData,
  encerrarAntes,
  ordinalNoMes,
} from './recorrencia.js'

describe('construirRecorrencia', () => {
  it('diária não depende da data', () => {
    expect(construirRecorrencia('diaria', new Date(2026, 8, 23))).toEqual(['RRULE:FREQ=DAILY'])
  })

  it('semanal usa o dia da semana da própria data (quarta = WE)', () => {
    // 2026-09-23 é uma quarta-feira.
    expect(construirRecorrencia('semanal', new Date(2026, 8, 23))).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=WE'])
  })

  it('mensal usa o dia do mês da própria data', () => {
    expect(construirRecorrencia('mensal', new Date(2026, 8, 23))).toEqual(['RRULE:FREQ=MONTHLY;BYMONTHDAY=23'])
  })

  it('anual não precisa de mais nada', () => {
    expect(construirRecorrencia('anual', new Date(2026, 8, 23))).toEqual(['RRULE:FREQ=YEARLY'])
  })

  it('"nunca" ou um id desconhecido não geram regra', () => {
    expect(construirRecorrencia('nunca', new Date())).toEqual([])
    expect(construirRecorrencia('outracoisa', new Date())).toEqual([])
  })
})

// 2026-10-22 é a quarta quinta-feira de outubro.
const quinta = new Date(2026, 9, 22)

describe('lerRecorrencia / montarRecorrencia', () => {
  it('ida e volta das regras que o editor monta', () => {
    const regras = [
      'RRULE:FREQ=DAILY',
      'RRULE:FREQ=DAILY;INTERVAL=3',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TH;COUNT=10',
      'RRULE:FREQ=MONTHLY;BYMONTHDAY=22',
      'RRULE:FREQ=MONTHLY;BYDAY=4TH',
      'RRULE:FREQ=MONTHLY;BYDAY=-1FR',
      'RRULE:FREQ=YEARLY;UNTIL=20301231',
    ]
    for (const r of regras) {
      const lida = lerRecorrencia([r], quinta)
      expect(lida.suportada).toBe(true)
      expect(montarRRule(lida.regra, true)).toBe(r)
    }
  })

  it('preenche o que a regra deixa implícito com a data do compromisso', () => {
    expect(lerRecorrencia(['RRULE:FREQ=WEEKLY'], quinta).regra.dias).toEqual(['TH'])
    expect(lerRecorrencia(['RRULE:FREQ=MONTHLY'], quinta).regra.diaDoMes).toBe(22)
  })

  it('lê o UNTIL com hora (UTC) como a data local', () => {
    const lida = lerRecorrencia(['RRULE:FREQ=DAILY;UNTIL=20261130T235959Z'], quinta)
    expect(lida.regra.fim.tipo).toBe('data')
    expect(['2026-11-30', '2026-12-01']).toContain(lida.regra.fim.data)
  })

  it('UNTIL de evento com hora sai em UTC, e cobre o dia escolhido inteiro', () => {
    const r = montarRRule({ freq: 'DAILY', intervalo: 1, fim: { tipo: 'data', data: '2026-11-30' } }, false)
    const until = /UNTIL=(\d{8}T\d{6}Z)/.exec(r)[1]
    const d = new Date(`${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}T${until.slice(9, 11)}:${until.slice(11, 13)}:${until.slice(13, 15)}Z`)
    expect(d.getDate()).toBe(30)
    expect(d.getHours()).toBe(23)
  })

  it('o que o editor não sabe montar fica marcado, sem virar "não repete"', () => {
    expect(lerRecorrencia(['RRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1'], quinta).suportada).toBe(false)
    expect(lerRecorrencia(['RRULE:FREQ=DAILY', 'RRULE:FREQ=WEEKLY'], quinta).suportada).toBe(false)
    expect(lerRecorrencia(['RRULE:FREQ=HOURLY'], quinta).suportada).toBe(false)
  })

  it('preserva EXDATE ao remontar, e sem regra não repete', () => {
    const lida = lerRecorrencia(['RRULE:FREQ=DAILY', 'EXDATE:20261025T130000Z'], quinta)
    expect(lida.extras).toEqual(['EXDATE:20261025T130000Z'])
    expect(montarRecorrencia(lida.regra, lida.extras)).toEqual(['RRULE:FREQ=DAILY', 'EXDATE:20261025T130000Z'])
    expect(montarRecorrencia(null, lida.extras)).toEqual([])
    expect(lerRecorrencia(undefined, quinta)).toEqual({ regra: null, extras: [], suportada: true })
  })
})

describe('opções rápidas', () => {
  it('escreve as opções com a data, como o Google', () => {
    const labels = opcoesDeRepeticao(quinta).map((o) => o.label)
    expect(labels).toContain('Semanal: cada quinta-feira')
    expect(labels).toContain('Mensal: na quarta quinta-feira')
    expect(labels).toContain('Anual: em 22 de outubro')
    expect(labels).toContain('Todos os dias úteis (segunda a sexta-feira)')
  })

  it('sábado e domingo são masculinos', () => {
    // 2026-10-31 é o último sábado de outubro.
    expect(opcoesDeRepeticao(new Date(2026, 9, 31)).find((o) => o.id === 'mensal-semana').label).toBe('Mensal: no último sábado')
  })

  it('reconhece a opção de uma regra, ou diz que é personalizada', () => {
    expect(opcaoDaRegra(null, quinta)).toBe('nunca')
    expect(opcaoDaRegra(lerRecorrencia(['RRULE:FREQ=WEEKLY;BYDAY=TH'], quinta).regra, quinta)).toBe('semanal')
    expect(opcaoDaRegra(lerRecorrencia(['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'], quinta).regra, quinta)).toBe('dias-uteis')
    expect(opcaoDaRegra(lerRecorrencia(['RRULE:FREQ=MONTHLY;BYDAY=4TH'], quinta).regra, quinta)).toBe('mensal-semana')
    expect(opcaoDaRegra(lerRecorrencia(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TH'], quinta).regra, quinta)).toBe('personalizada')
  })

  it('a quinta ocorrência do dia no mês vira "a última"', () => {
    expect(ordinalNoMes(new Date(2026, 9, 29))).toBe(-1)
  })

  it('oferece "a última" também quando a quarta é a última do mês', () => {
    // 2026-10-27: quarta terça-feira, e a última de outubro.
    expect(opcoesMensais(new Date(2026, 9, 27)).map((m) => m.label)).toEqual([
      'Mensal no dia 27',
      'Mensal na quarta terça-feira',
      'Mensal na última terça-feira',
    ])
  })

  it('descreve uma regra personalizada em uma frase', () => {
    const r = lerRecorrencia(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261130'], quinta).regra
    expect(descreverRegra(r, quinta)).toBe('A cada 2 semanas: segunda e quarta, até 30 de novembro de 2026')
    const c = lerRecorrencia(['RRULE:FREQ=MONTHLY;BYMONTHDAY=5;COUNT=6'], quinta).regra
    expect(descreverRegra(c, quinta)).toBe('Mensal, no dia 5, 6 vezes')
  })
})

describe('acompanharData', () => {
  const sexta = new Date(2026, 9, 23)

  it('a regra que era o dia do compromisso muda junto com ele', () => {
    const semanal = lerRecorrencia(['RRULE:FREQ=WEEKLY;BYDAY=TH'], quinta).regra
    expect(acompanharData(semanal, quinta, sexta).dias).toEqual(['FR'])
    const mensal = lerRecorrencia(['RRULE:FREQ=MONTHLY;BYMONTHDAY=22'], quinta).regra
    expect(acompanharData(mensal, quinta, sexta).diaDoMes).toBe(23)
    const ordinal = lerRecorrencia(['RRULE:FREQ=MONTHLY;BYDAY=4TH'], quinta).regra
    expect(acompanharData(ordinal, quinta, sexta)).toMatchObject({ ordinal: 4, diaDaSemana: 'FR' })
  })

  it('a que não era o dia dele fica como está (o mesmo objeto)', () => {
    const varios = lerRecorrencia(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'], quinta).regra
    expect(acompanharData(varios, quinta, sexta)).toBe(varios)
    const diaria = lerRecorrencia(['RRULE:FREQ=DAILY'], quinta).regra
    expect(acompanharData(diaria, quinta, sexta)).toBe(diaria)
  })
})

describe('encerrarAntes', () => {
  it('corta a série um segundo antes da ocorrência, trocando COUNT/UNTIL', () => {
    const corte = new Date('2026-10-22T17:00:00Z')
    expect(encerrarAntes(['RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=10', 'EXDATE:20261015T170000Z'], corte, false)).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261022T165959Z',
      'EXDATE:20261015T170000Z',
    ])
  })

  it('em dia inteiro, termina no dia anterior', () => {
    expect(encerrarAntes(['RRULE:FREQ=DAILY;UNTIL=20271231'], new Date(2026, 9, 22), true)).toEqual([
      'RRULE:FREQ=DAILY;UNTIL=20261021',
    ])
  })
})

describe('detectarRecorrencia', () => {
  it('reconhece as frases mais comuns de repetição em português', () => {
    expect(detectarRecorrencia('Reunião todos os dias 9h')).toBe('diaria')
    expect(detectarRecorrencia('Ginástica diariamente às 7h')).toBe('diaria')
    expect(detectarRecorrencia('Reunião toda segunda 14h')).toBe('semanal')
    expect(detectarRecorrencia('Reunião toda segunda-feira 14h')).toBe('semanal')
    expect(detectarRecorrencia('Relatório semanalmente')).toBe('semanal')
    expect(detectarRecorrencia('Pagar o boleto todo mês')).toBe('mensal')
    expect(detectarRecorrencia('Revisar contrato mensalmente')).toBe('mensal')
    expect(detectarRecorrencia('Aniversário todo ano')).toBe('anual')
  })

  it('sem nenhuma frase de repetição, devolve null', () => {
    expect(detectarRecorrencia('Reunião amanhã 14h')).toBe(null)
  })
})
