import { describe, expect, it } from 'vitest'
import { textoDaDescricao, outrosConvidados, tarefaDoEvento, horarioSugerido, eventoDaTarefa } from './conversao.js'
import { PROJETO_PROP } from './projetos.js'

const evento = (extra = {}) => ({
  id: 'ev1',
  summary: 'Reunião com a saúde',
  start: { dateTime: '2026-11-17T13:00:00-03:00' },
  end: { dateTime: '2026-11-17T14:30:00-03:00' },
  ...extra,
})

describe('compromisso → tarefa', () => {
  it('leva título, dia como prazo, duração e projeto', () => {
    const t = tarefaDoEvento(evento({ extendedProperties: { private: { [PROJETO_PROP]: 'caso-silva' } } }))
    expect(t.title).toBe('Reunião com a saúde')
    expect(t.due.getFullYear()).toBe(2026)
    expect([t.due.getMonth(), t.due.getDate(), t.due.getHours()]).toEqual([10, 17, 0])
    expect(t.duracao).toBe(90)
    expect(t.projeto).toBe('caso-silva')
  })

  it('guarda descrição (sem HTML), local e videochamada no texto, para nada se perder', () => {
    const t = tarefaDoEvento(
      evento({
        description: 'Pauta:<br>- vagas<br><a href="https://x.org/doc">ata</a> &amp; lista',
        location: 'CRAS Centro',
        hangoutLink: 'https://meet.google.com/abc',
      })
    )
    expect(t.notes).toBe('Pauta:\n- vagas\nata (https://x.org/doc) & lista\n\nLocal: CRAS Centro\n\nVideochamada: https://meet.google.com/abc')
  })

  it('dia inteiro vira prazo daquele dia, sem duração', () => {
    const t = tarefaDoEvento({ summary: 'Férias', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } })
    expect([t.due.getMonth(), t.due.getDate()]).toEqual([10, 20])
    expect(t.duracao).toBeNull()
    expect(t.notes).toBe('')
  })

  it('sem título, não nasce tarefa vazia', () => {
    expect(tarefaDoEvento(evento({ summary: '  ' })).title).toBe('Sem título')
  })

  it('convidados: só conta gente que não é você nem sala', () => {
    expect(outrosConvidados(evento())).toEqual([])
    expect(
      outrosConvidados(evento({ attendees: [{ email: 'eu', self: true }, { email: 'sala', resource: true }, { email: 'ana' }] })).map((a) => a.email)
    ).toEqual(['ana'])
  })

  it('textoDaDescricao deixa texto puro como está', () => {
    expect(textoDaDescricao('linha 1\nlinha 2')).toBe('linha 1\nlinha 2')
    expect(textoDaDescricao(undefined)).toBe('')
  })
})

describe('tarefa → compromisso', () => {
  const agora = new Date(2026, 10, 16, 10, 7) // segunda, 10h07

  it('sem prazo: hoje, na próxima meia hora cheia, com a duração da tarefa', () => {
    expect(horarioSugerido({ duracao: 45 }, agora)).toEqual({ data: '2026-11-16', inicio: '10:30', fim: '11:15' })
  })

  it('prazo que ainda vem: naquele dia às 9h, uma hora se não tem duração', () => {
    expect(horarioSugerido({ due: '2026-11-19T00:00:00.000Z' }, agora)).toEqual({ data: '2026-11-19', inicio: '09:00', fim: '10:00' })
  })

  it('prazo vencido conta como hoje', () => {
    expect(horarioSugerido({ due: '2026-11-10T00:00:00.000Z' }, agora).data).toBe('2026-11-16')
  })

  it('tarde da noite, fica para amanhã às 9h', () => {
    expect(horarioSugerido({}, new Date(2026, 10, 16, 22, 40))).toEqual({ data: '2026-11-17', inicio: '09:00', fim: '10:00' })
  })

  it('o fim não vira o dia', () => {
    expect(horarioSugerido({ due: '2026-11-19T00:00:00.000Z', duracao: 24 * 60 }, agora).fim).toBe('23:59')
  })

  it('o texto da tarefa vira descrição e o projeto vai na marca do evento', () => {
    const start = new Date(2026, 10, 17, 9)
    const end = new Date(2026, 10, 17, 10)
    const e = eventoDaTarefa(
      { title: 'Ligar para a escola', notesClean: 'Falar com a diretora\n📎 Ofício — https://docs.google.com/x', projeto: 'caso-silva' },
      { titulo: ' Ligar para a escola sobre a vaga ', start, end, calendarId: 'trabalho' }
    )
    expect(e).toEqual({
      title: 'Ligar para a escola sobre a vaga',
      start,
      end,
      calendarId: 'trabalho',
      description: 'Falar com a diretora\n📎 Ofício — https://docs.google.com/x',
      extendedProperties: { private: { [PROJETO_PROP]: 'caso-silva' } },
    })
  })

  it('sem projeto nem texto, o evento sai limpo', () => {
    const e = eventoDaTarefa({ title: 'Arte folder' }, { start: new Date(), end: new Date() })
    expect(e.description).toBeUndefined()
    expect(e.extendedProperties).toBeUndefined()
    expect(e.calendarId).toBe('primary')
  })
})
