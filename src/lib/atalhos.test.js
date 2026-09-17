import { describe, expect, it } from 'vitest'
import { atalhoDoEvento } from './atalhos.js'

function tecla(key, extra = {}) {
  return { key, target: { tagName: 'DIV' }, ...extra }
}

describe('atalhoDoEvento', () => {
  it('reconhece cada atalho', () => {
    expect(atalhoDoEvento(tecla('c'))).toBe('criar')
    expect(atalhoDoEvento(tecla('a'))).toBe('agente')
    expect(atalhoDoEvento(tecla('n'))).toBe('notas')
    expect(atalhoDoEvento(tecla('b'))).toBe('buscar')
    expect(atalhoDoEvento(tecla('/'))).toBe('buscar')
    expect(atalhoDoEvento(tecla('p'))).toBe('pomodoro')
    expect(atalhoDoEvento(tecla('1'))).toBe('vista-dia')
    expect(atalhoDoEvento(tecla('3'))).toBe('vista-mes')
    expect(atalhoDoEvento(tecla('h'))).toBe('hoje')
    expect(atalhoDoEvento(tecla('ArrowLeft'))).toBe('anterior')
    expect(atalhoDoEvento(tecla('ArrowRight'))).toBe('proximo')
    expect(atalhoDoEvento(tecla('?'))).toBe('ajuda')
  })

  it('aceita a tecla com Shift ou Caps (C continua sendo criar)', () => {
    expect(atalhoDoEvento(tecla('C'))).toBe('criar')
  })

  it('não dispara enquanto a pessoa digita num campo', () => {
    // O teste que importa: todo painel do trilho abre com o cursor dentro de
    // um campo. Sem esta guarda, escrever "casa" numa anotação abriria o
    // criar, o agente e a busca.
    expect(atalhoDoEvento(tecla('c', { target: { tagName: 'INPUT' } }))).toBe(null)
    expect(atalhoDoEvento(tecla('a', { target: { tagName: 'TEXTAREA' } }))).toBe(null)
    expect(atalhoDoEvento(tecla('n', { target: { tagName: 'SELECT' } }))).toBe(null)
    expect(atalhoDoEvento(tecla('b', { target: { tagName: 'DIV', isContentEditable: true } }))).toBe(null)
  })

  it('não rouba os atalhos do navegador', () => {
    expect(atalhoDoEvento(tecla('p', { ctrlKey: true }))).toBe(null)
    expect(atalhoDoEvento(tecla('b', { metaKey: true }))).toBe(null)
    expect(atalhoDoEvento(tecla('1', { altKey: true }))).toBe(null)
  })

  it('deixa o Escape para quem já cuida dele', () => {
    expect(atalhoDoEvento(tecla('Escape'))).toBe(null)
  })

  it('ignora tecla sem atalho e evento vazio', () => {
    expect(atalhoDoEvento(tecla('z'))).toBe(null)
    expect(atalhoDoEvento(tecla('Enter'))).toBe(null)
    expect(atalhoDoEvento(null)).toBe(null)
  })
})
