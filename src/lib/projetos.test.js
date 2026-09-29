import { describe, expect, it } from 'vitest'
import {
  normalizarProjeto,
  normalizarProjetos,
  novoProjeto,
  listarProjetos,
  tarefasDoProjeto,
  eventoDoProjeto,
  PROJETO_PROP,
} from './projetos.js'

const PROXIMAS = 'l-proximas'
const AGUARDANDO = 'l-aguardando'
const ALGUM_DIA = 'l-algum-dia'
const ENTRADA = 'l-entrada'
const agora = new Date('2026-09-29T12:00:00')

describe('novoProjeto', () => {
  it('usa a etiqueta do nome como id, para as tarefas #etiqueta caírem nele sozinhas', () => {
    const p = novoProjeto('Caso Maria', agora)
    expect(p).toMatchObject({ id: 'caso-maria', nome: 'Caso Maria', situacao: 'ativo', resultado: '', prazo: null })
  })

  it('nome que não vira etiqueta nenhuma não vira projeto', () => {
    expect(novoProjeto('   ', agora)).toBe(null)
    expect(novoProjeto('!!!', agora)).toBe(null)
  })
})

describe('normalizarProjeto', () => {
  it('mantém uma ficha válida', () => {
    const p = { id: 'x', nome: 'X', resultado: 'r', situacao: 'pausado', prazo: '2026-10-01', createdAt: 'a', updatedAt: 'b' }
    expect(normalizarProjeto(p, agora)).toEqual(p)
  })

  it('descarta campo estranho e corrige tipo errado', () => {
    const p = normalizarProjeto({ id: 'x', nome: 42, situacao: 'inventada', prazo: 'amanhã', lixo: { a: 1 } }, agora)
    expect(p).toEqual({
      id: 'x',
      nome: 'x',
      resultado: '',
      situacao: 'ativo',
      prazo: null,
      createdAt: agora.toISOString(),
      updatedAt: agora.toISOString(),
    })
  })

  it('sem id não é projeto', () => {
    expect(normalizarProjeto({ nome: 'x' })).toBe(null)
    expect(normalizarProjetos([null, { id: 'a' }, 'x'], agora).map((p) => p.id)).toEqual(['a'])
    expect(normalizarProjetos(undefined)).toEqual([])
  })
})

describe('listarProjetos', () => {
  const registros = [
    { id: 'caso-maria', nome: 'Caso Maria', resultado: '', situacao: 'ativo', prazo: null, updatedAt: '2026-09-01T00:00:00.000Z' },
    { id: 'arquivo', nome: 'Arquivo', resultado: '', situacao: 'concluido', prazo: null, updatedAt: '2026-08-01T00:00:00.000Z' },
  ]

  it('junta fichas e etiquetas soltas, e acha a próxima ação', () => {
    const tasks = [
      { id: 't1', title: 'Ligar', projeto: 'caso-maria', tasklistId: PROXIMAS, status: 'needsAction', priority: 'alta', updated: '2026-09-20T00:00:00.000Z' },
      { id: 't2', title: 'Parecer', projeto: 'caso-maria', tasklistId: AGUARDANDO, status: 'needsAction' },
      { id: 't3', title: 'Solta', projeto: 'caso-joao', tasklistId: AGUARDANDO, status: 'needsAction' },
    ]
    const notes = [{ id: 'n1', projeto: 'caso-maria', updatedAt: '2026-09-25T00:00:00.000Z' }]
    const lista = listarProjetos({ registros, tasks, notes, idProximas: PROXIMAS }, agora)

    expect(lista).toHaveLength(3)
    // Concluído vai para o fim, independente do nome.
    expect(lista[2].id).toBe('arquivo')
    const maria = lista.find((p) => p.id === 'caso-maria')
    expect(maria).toMatchObject({ pendentes: 2, anotacoes: 1, semProximaAcao: false, implicito: false })
    expect(maria.proximaAcao.id).toBe('t1')
    expect(maria.ultimaAtividade).toBe('2026-09-25T00:00:00.000Z')

    const joao = lista.find((p) => p.id === 'caso-joao')
    expect(joao).toMatchObject({ implicito: true, semProximaAcao: true, situacao: 'ativo' })
  })

  it('projeto concluído ou pausado nunca é cobrado por falta de próxima ação', () => {
    const lista = listarProjetos({ registros, tasks: [], notes: [], idProximas: PROXIMAS }, agora)
    expect(lista.find((p) => p.id === 'arquivo').semProximaAcao).toBe(false)
  })

  it('conta as atrasadas', () => {
    const tasks = [
      { id: 't1', projeto: 'caso-maria', tasklistId: PROXIMAS, status: 'needsAction', due: '2026-09-10T00:00:00.000Z' },
    ]
    const lista = listarProjetos({ registros, tasks, notes: [], idProximas: PROXIMAS }, agora)
    expect(lista.find((p) => p.id === 'caso-maria').atrasadas).toBe(1)
  })
})

describe('tarefasDoProjeto', () => {
  it('separa por lista, com as concluídas mais recentes primeiro', () => {
    const tasks = [
      { id: 'a', projeto: 'p', tasklistId: PROXIMAS, status: 'needsAction' },
      { id: 'b', projeto: 'p', tasklistId: AGUARDANDO, status: 'needsAction' },
      { id: 'c', projeto: 'p', tasklistId: ALGUM_DIA, status: 'needsAction' },
      { id: 'd', projeto: 'p', tasklistId: ENTRADA, status: 'needsAction' },
      { id: 'e', projeto: 'p', tasklistId: 'antiga', status: 'needsAction' },
      { id: 'f', projeto: 'p', tasklistId: PROXIMAS, status: 'completed', completed: '2026-09-01T00:00:00.000Z' },
      { id: 'g', projeto: 'p', tasklistId: PROXIMAS, status: 'completed', completed: '2026-09-20T00:00:00.000Z' },
      { id: 'h', projeto: 'outro', tasklistId: PROXIMAS, status: 'needsAction' },
    ]
    const g = tarefasDoProjeto(tasks, 'p', { idProximas: PROXIMAS, idAguardando: AGUARDANDO, idAlgumDia: ALGUM_DIA, idEntrada: ENTRADA })
    expect(g.proximas.map((t) => t.id)).toEqual(['a'])
    expect(g.aguardando.map((t) => t.id)).toEqual(['b'])
    expect(g.algumDia.map((t) => t.id)).toEqual(['c'])
    expect(g.entrada.map((t) => t.id)).toEqual(['d'])
    expect(g.outras.map((t) => t.id)).toEqual(['e'])
    expect(g.concluidas.map((t) => t.id)).toEqual(['g', 'f'])
  })
})

describe('eventoDoProjeto', () => {
  it('reconhece pela marca privada gravada pelo app', () => {
    expect(eventoDoProjeto({ extendedProperties: { private: { [PROJETO_PROP]: 'caso-maria' } } }, 'caso-maria')).toBe(true)
  })

  it('reconhece pela etiqueta escrita no título ou na descrição', () => {
    expect(eventoDoProjeto({ summary: 'Visita #caso-maria' }, 'caso-maria')).toBe(true)
    expect(eventoDoProjeto({ summary: 'Visita', description: 'ver #Caso-Maria' }, 'caso-maria')).toBe(true)
  })

  it('não confunde com etiqueta mais longa nem com outro projeto', () => {
    expect(eventoDoProjeto({ summary: 'Visita #caso-maria-2' }, 'caso-maria')).toBe(false)
    expect(eventoDoProjeto({ summary: 'Visita #caso-joao' }, 'caso-maria')).toBe(false)
    expect(eventoDoProjeto({ summary: 'Visita' }, 'caso-maria')).toBe(false)
  })
})
