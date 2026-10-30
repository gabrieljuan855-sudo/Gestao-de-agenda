import { describe, it, expect } from 'vitest'
import { separarAnexos, juntarAnexos, anexoDoLink } from './anexosNoTexto.js'

const PDF = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view'
const DOC = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit'

describe('anexos no texto da tarefa', () => {
  it('ida e volta: o texto e os anexos voltam iguais', () => {
    const texto = juntarAnexos('Ligar antes das 10h', [anexoDoLink('Ofício 12.pdf', PDF), anexoDoLink('Relatório', DOC)])
    expect(texto).toBe(`Ligar antes das 10h\n\n📎 Ofício 12.pdf — ${PDF}\n📎 Relatório — ${DOC}`)
    const { texto: limpo, anexos } = separarAnexos(texto)
    expect(limpo).toBe('Ligar antes das 10h')
    expect(anexos.map((a) => a.nome)).toEqual(['Ofício 12.pdf', 'Relatório'])
  })

  it('reconhece o arquivo do Drive e o documento do Google', () => {
    expect(anexoDoLink('a.pdf', PDF)).toMatchObject({ driveId: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345' })
    expect(anexoDoLink('a.pdf', PDF).mime).toBeUndefined()
    expect(anexoDoLink('Relatório', DOC).mime).toBe('application/vnd.google-apps.document')
    expect(anexoDoLink('site', 'https://site.com/x').driveId).toBeUndefined()
  })

  it('não confunde texto comum com anexo e recusa link que não é http', () => {
    const { texto, anexos } = separarAnexos('📎 sem link\n📎 x — javascript:alert(1)\nobs')
    expect(anexos).toEqual([])
    expect(texto).toBe('📎 sem link\n📎 x — javascript:alert(1)\nobs')
  })

  it('travessão no nome vira hífen para a leitura de volta não se perder', () => {
    const { anexos } = separarAnexos(juntarAnexos('', [{ nome: 'Ata — rede', url: PDF }]))
    expect(anexos[0].nome).toBe('Ata - rede')
  })

  it('sem anexos, o texto fica como está', () => {
    expect(juntarAnexos('  só texto ', [])).toBe('só texto')
    expect(separarAnexos('')).toEqual({ texto: '', anexos: [] })
  })
})
