import { describe, expect, it } from 'vitest'
import { extrairVersao, temVersaoNova } from './versao.js'

describe('extrairVersao', () => {
  it('acha o script principal do build no HTML ou numa URL', () => {
    expect(extrairVersao('<script type="module" src="./assets/index-DIBnx3RB.js"></script>')).toBe('assets/index-DIBnx3RB.js')
    expect(extrairVersao('https://app.exemplo/assets/index-a_b-1.js')).toBe('assets/index-a_b-1.js')
  })

  it('sem script de build (desenvolvimento), não há versão', () => {
    expect(extrairVersao('<script type="module" src="/src/main.jsx"></script>')).toBe(null)
    expect(extrairVersao(undefined)).toBe(null)
  })
})

describe('temVersaoNova', () => {
  it('só avisa com as duas versões conhecidas e diferentes', () => {
    expect(temVersaoNova('assets/index-A.js', 'assets/index-B.js')).toBe(true)
    expect(temVersaoNova('assets/index-A.js', 'assets/index-A.js')).toBe(false)
    expect(temVersaoNova(null, 'assets/index-B.js')).toBe(false)
    expect(temVersaoNova('assets/index-A.js', null)).toBe(false)
  })
})
