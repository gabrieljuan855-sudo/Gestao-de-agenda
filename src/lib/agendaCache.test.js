import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lerCacheDeAgenda, gravarCacheDeAgenda } from './agendaCache.js'

// O cache mora no localStorage; o ambiente de teste do vitest não tem um.
beforeEach(() => {
  const dados = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => dados.set(k, String(v)),
    removeItem: (k) => dados.delete(k),
  })
})

describe('lerCacheDeAgenda', () => {
  it('devolve listas vazias quando não há nada gravado ainda', () => {
    expect(lerCacheDeAgenda()).toEqual({ events: [], tasks: [], calendars: [] })
  })

  it('sobrevive a lixo gravado (localStorage corrompido)', () => {
    localStorage.setItem('gestao-agenda:cache-agenda', '{isso não é json')
    expect(lerCacheDeAgenda()).toEqual({ events: [], tasks: [], calendars: [] })
  })
})

describe('gravarCacheDeAgenda', () => {
  it('grava e relê exatamente o que foi passado', () => {
    const events = [{ id: 'e1', summary: 'Reunião' }]
    const tasks = [{ id: 't1', title: 'Ligar para a Ana' }]
    const calendars = [{ id: 'primary', summary: 'Agenda principal' }]

    gravarCacheDeAgenda({ events, tasks, calendars })

    expect(lerCacheDeAgenda()).toEqual({ events, tasks, calendars })
  })

  it('atualiza só o que foi passado, mantendo o resto do cache intacto', () => {
    // reload() busca eventos e tarefas juntos, mas listCalendars roda à
    // parte (só uma vez, ao entrar) — uma chamada não pode apagar o que a
    // outra já tinha gravado.
    gravarCacheDeAgenda({ events: [{ id: 'e1' }], tasks: [{ id: 't1' }], calendars: [{ id: 'primary' }] })
    gravarCacheDeAgenda({ events: [{ id: 'e2' }], tasks: [{ id: 't2' }] })

    expect(lerCacheDeAgenda()).toEqual({
      events: [{ id: 'e2' }],
      tasks: [{ id: 't2' }],
      calendars: [{ id: 'primary' }],
    })
  })

  it('não quebra sem localStorage disponível', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => gravarCacheDeAgenda({ events: [], tasks: [], calendars: [] })).not.toThrow()
  })
})
