import { describe, it, expect } from 'vitest'
import { MODELOS, aplicarModelo } from './modelosDeProjeto.js'

const agora = new Date('2026-10-30T12:00:00Z')

describe('modelos de projeto', () => {
  it('existem os cinco modelos da rotina', () => {
    expect(MODELOS.map((m) => m.id)).toEqual(['caso', 'pop', 'oficio', 'reuniao-rede', 'calamidade'])
  })

  it('o modelo cria a ficha com resultado e marcos na ordem do trabalho', () => {
    const { ficha, tarefas, nota } = aplicarModelo('pop', 'POP Acolhimento', agora)
    expect(ficha).toMatchObject({ id: 'pop-acolhimento', nome: 'POP Acolhimento', tipo: 'projeto', situacao: 'ativo' })
    expect(ficha.resultado).toMatch(/aprovado/)
    expect(ficha.marcos.map((m) => m.titulo)).toEqual(MODELOS[1].marcos)
    expect(new Set(ficha.marcos.map((m) => m.id)).size).toBe(ficha.marcos.length)
    expect(tarefas.every((t) => t.projeto === 'pop-acolhimento')).toBe(true)
    expect(nota).toMatchObject({ title: 'Estrutura do POP — POP Acolhimento', projeto: 'pop-acolhimento' })
  })

  it('modelo sem anotação-base não cria nota', () => {
    expect(aplicarModelo('oficio', 'Ofício 12', agora).nota).toBeNull()
  })

  it('recusa modelo desconhecido e nome sem letras', () => {
    expect(aplicarModelo('xyz', 'Algo', agora)).toBeNull()
    expect(aplicarModelo('caso', '!!!', agora)).toBeNull()
  })
})
