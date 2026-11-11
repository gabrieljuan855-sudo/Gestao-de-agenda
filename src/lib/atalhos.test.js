import { describe, expect, it } from 'vitest'
import { atalhoDoEvento, textoParaCapturar } from './atalhos.js'

function tecla(key, extra = {}) {
  return { key, target: { tagName: 'DIV' }, ...extra }
}
const comAlt = (key, code) => tecla(key, { altKey: true, code })

describe('atalhoDoEvento', () => {
  it('os painéis abrem com Alt, pela tecla física (Option+C no Mac escreve "ç")', () => {
    expect(atalhoDoEvento(comAlt('ç', 'KeyC'))).toBe('criar')
    expect(atalhoDoEvento(comAlt('e', 'KeyE'))).toBe('entrada')
    expect(atalhoDoEvento(comAlt('p', 'KeyP'))).toBe('projetos')
    expect(atalhoDoEvento(comAlt('n', 'KeyN'))).toBe('notas')
    expect(atalhoDoEvento(comAlt('b', 'KeyB'))).toBe('buscar')
    expect(atalhoDoEvento(comAlt('¡', 'Digit1'))).toBe('vista-dia')
    expect(atalhoDoEvento(comAlt('3', 'Digit3'))).toBe('vista-mes')
    expect(atalhoDoEvento(comAlt('h', 'KeyH'))).toBe('hoje')
  })

  it('sem Alt ficam só as teclas que não começam frase', () => {
    expect(atalhoDoEvento(tecla('/'))).toBe('buscar')
    expect(atalhoDoEvento(tecla('?'))).toBe('ajuda')
    expect(atalhoDoEvento(tecla('ArrowLeft'))).toBe('anterior')
    expect(atalhoDoEvento(tecla('ArrowRight'))).toBe('proximo')
    expect(atalhoDoEvento(tecla('c'))).toBe(null)
    expect(atalhoDoEvento(tecla('1'))).toBe(null)
  })

  it('não dispara enquanto a pessoa digita num campo', () => {
    expect(atalhoDoEvento(comAlt('c', 'KeyC'))).toBe('criar')
    expect(atalhoDoEvento({ ...comAlt('c', 'KeyC'), target: { tagName: 'INPUT' } })).toBe(null)
    expect(atalhoDoEvento(tecla('/', { target: { tagName: 'TEXTAREA' } }))).toBe(null)
    expect(atalhoDoEvento(tecla('?', { target: { tagName: 'DIV', isContentEditable: true } }))).toBe(null)
  })

  it('não rouba os atalhos do navegador', () => {
    expect(atalhoDoEvento(tecla('p', { ctrlKey: true, code: 'KeyP' }))).toBe(null)
    expect(atalhoDoEvento(tecla('b', { metaKey: true, code: 'KeyB' }))).toBe(null)
  })

  it('deixa o Escape para quem já cuida dele', () => {
    expect(atalhoDoEvento(tecla('Escape'))).toBe(null)
  })

  it('ignora tecla sem atalho e evento vazio', () => {
    expect(atalhoDoEvento(comAlt('z', 'KeyZ'))).toBe(null)
    expect(atalhoDoEvento(tecla('Enter'))).toBe(null)
    expect(atalhoDoEvento(null)).toBe(null)
  })
})

describe('textoParaCapturar', () => {
  it('letra, número ou acento fora de um campo começam a captura', () => {
    expect(textoParaCapturar(tecla('l'))).toBe('l')
    expect(textoParaCapturar(tecla('L'))).toBe('L')
    expect(textoParaCapturar(tecla('1'))).toBe('1')
    expect(textoParaCapturar(tecla('é'))).toBe('é')
  })

  it('não captura dentro de campo, com modificador, compondo acento, espaço, atalho ou tecla de controle', () => {
    expect(textoParaCapturar(tecla('l', { target: { tagName: 'INPUT' } }))).toBe(null)
    expect(textoParaCapturar(tecla('c', { ctrlKey: true }))).toBe(null)
    expect(textoParaCapturar(tecla('c', { altKey: true }))).toBe(null)
    expect(textoParaCapturar(tecla('a', { isComposing: true }))).toBe(null)
    expect(textoParaCapturar(tecla(' '))).toBe(null)
    expect(textoParaCapturar(tecla('/'))).toBe(null)
    expect(textoParaCapturar(tecla('?'))).toBe(null)
    expect(textoParaCapturar(tecla('Enter'))).toBe(null)
    expect(textoParaCapturar(tecla('Dead'))).toBe(null)
    expect(textoParaCapturar(null)).toBe(null)
  })
})
