import { describe, it, expect } from 'vitest'
import {
  motivoDeRecusa,
  separarArquivos,
  mensagemDeRecusa,
  nomeDoColado,
  nomeAoRenomear,
  tipoDePrevia,
  podeBaixar,
  TAMANHO_MAXIMO,
} from './arquivosValidacao.js'

const MB = 1024 * 1024

describe('motivoDeRecusa', () => {
  it('aceita documentos, planilhas, imagens e áudio da rotina', () => {
    for (const name of ['Ofício 12.pdf', 'relatorio.DOCX', 'planilha.xlsx', 'foto.HEIC', 'reuniao.m4a', 'ata.odt']) {
      expect(motivoDeRecusa({ name, size: 2 * MB })).toBeNull()
    }
  })

  it('recusa executável, página, compactado e arquivo sem extensão', () => {
    expect(motivoDeRecusa({ name: 'setup.exe', size: MB })).toMatch(/\.exe não são aceitos/)
    expect(motivoDeRecusa({ name: 'pagina.html', size: MB })).toMatch(/não são aceitos/)
    expect(motivoDeRecusa({ name: 'tudo.zip', size: MB })).toMatch(/não são aceitos/)
    expect(motivoDeRecusa({ name: 'LEIAME', size: MB })).toMatch(/sem extensão/)
  })

  it('recusa vazio e acima do limite', () => {
    expect(motivoDeRecusa({ name: 'a.pdf', size: 0 })).toMatch(/vazio/)
    expect(motivoDeRecusa({ name: 'a.mp4', size: TAMANHO_MAXIMO + 1 })).toMatch(/acima do limite de 100 MB/)
  })
})

describe('separarArquivos', () => {
  it('envia os bons e explica os outros numa mensagem só', () => {
    const { validos, recusados } = separarArquivos([
      { name: 'a.pdf', size: MB },
      { name: 'b.exe', size: MB },
    ])
    expect(validos.map((v) => v.name)).toEqual(['a.pdf'])
    expect(mensagemDeRecusa(recusados)).toMatch(/^"b\.exe" não foi enviado/)
    expect(mensagemDeRecusa([])).toBeNull()
  })
})

describe('nomes', () => {
  it('dá nome com data à imagem colada, e mantém nome de verdade', () => {
    const agora = new Date(2026, 9, 30, 9, 5, 7)
    expect(nomeDoColado('image.png', 'image/png', agora)).toBe('Imagem colada 2026-10-30 09h05m07s.png')
    expect(nomeDoColado('', 'image/jpeg', agora)).toBe('Imagem colada 2026-10-30 09h05m07s.jpg')
    expect(nomeDoColado('Ofício.pdf', 'application/pdf', agora)).toBe('Ofício.pdf')
  })

  it('renomear mantém a extensão e não aceita barra nem nome vazio', () => {
    expect(nomeAoRenomear('Ofício 12 - resposta', 'arquivo.pdf')).toBe('Ofício 12 - resposta.pdf')
    expect(nomeAoRenomear('outro.docx', 'arquivo.pdf')).toBe('outro.docx')
    expect(nomeAoRenomear('a/b', 'x.pdf')).toBe('a-b.pdf')
    expect(nomeAoRenomear('   ', 'x.pdf')).toBeNull()
  })
})

describe('prévia e download', () => {
  it('mostra PDF e imagem do Drive até 30 MB', () => {
    expect(tipoDePrevia({ driveId: 'x', mime: 'application/pdf', nome: 'a.pdf', tamanho: MB })).toBe('pdf')
    expect(tipoDePrevia({ driveId: 'x', mime: 'image/jpeg', nome: 'a.jpg' })).toBe('imagem')
    expect(tipoDePrevia({ driveId: 'x', mime: 'application/pdf', nome: 'a.pdf', tamanho: 40 * MB })).toBeNull()
    expect(tipoDePrevia({ mime: 'application/pdf', nome: 'a.pdf' })).toBeNull()
    expect(tipoDePrevia({ driveId: 'x', mime: 'image/heic', nome: 'a.heic' })).toBeNull()
  })

  it('Documento do Google não se baixa, abre no Docs', () => {
    expect(podeBaixar({ driveId: 'x', mime: 'application/pdf' })).toBe(true)
    expect(podeBaixar({ driveId: 'x', mime: 'application/vnd.google-apps.document' })).toBe(false)
    expect(podeBaixar({ url: 'https://site.com/a.pdf' })).toBe(false)
  })
})
