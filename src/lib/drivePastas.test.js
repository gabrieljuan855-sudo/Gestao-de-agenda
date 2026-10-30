import { describe, expect, it } from 'vitest'
import { criarDriveDosProjetos, NOME_DA_PASTA_RAIZ } from './drivePastas.js'

// Um Drive mínimo em memória: pastas e arquivos com pais, a busca por nome
// dentro de uma pasta e a criação. Só o que drivePastas usa.
function driveFalso() {
  let seq = 0
  const arquivos = []
  const chamadas = []
  async function request(url, opcoes = {}) {
    const u = new URL(url)
    const metodo = opcoes.method || 'GET'
    chamadas.push(`${metodo} ${u.pathname}`)
    const umSo = u.pathname.match(/\/files\/([^/]+)$/)
    if (metodo === 'GET' && umSo) {
      const f = arquivos.find((a) => a.id === decodeURIComponent(umSo[1]))
      if (!f) throw Object.assign(new Error('404'), { status: 404 })
      return { id: f.id, trashed: Boolean(f.trashed), webViewLink: `https://drive/${f.id}` }
    }
    if (metodo === 'GET') {
      const q = u.searchParams.get('q')
      const nome = q.match(/name = '((?:\\'|[^'])*)'/)[1].replace(/\\'/g, "'")
      const pai = q.match(/'([^']*)' in parents/)[1]
      const achados = arquivos.filter((a) => a.name === nome && a.parents.includes(pai) && !a.trashed)
      return { files: achados.map((a) => ({ id: a.id, webViewLink: `https://drive/${a.id}` })) }
    }
    const corpo = JSON.parse(opcoes.body)
    const novo = { id: `f${++seq}`, ...corpo }
    arquivos.push(novo)
    return { id: novo.id, name: novo.name, mimeType: novo.mimeType, webViewLink: `https://drive/${novo.id}` }
  }
  return { request, arquivos, chamadas }
}

describe('pastas dos projetos no Drive', () => {
  it('cria "Segundo Cérebro" e a pasta do projeto dentro dela, e reaproveita na segunda vez', async () => {
    const d = driveFalso()
    const drive = criarDriveDosProjetos(d.request)
    const { pasta, nova } = await drive.pastaDoProjeto({ id: 'caso-silva', nome: "Caso D'Ávila" })
    expect(nova).toBe(true)
    const raiz = d.arquivos.find((a) => a.name === NOME_DA_PASTA_RAIZ)
    expect(raiz.parents).toEqual(['root'])
    expect(d.arquivos.find((a) => a.id === pasta.id)).toMatchObject({ name: "Caso D'Ávila", parents: [raiz.id] })

    // Outro projeto: a raiz é a mesma, achada pela busca.
    await drive.pastaDoProjeto({ id: 'outro', nome: 'Outro' })
    expect(d.arquivos.filter((a) => a.name === NOME_DA_PASTA_RAIZ)).toHaveLength(1)

    // Com a pasta guardada no projeto, nem procura.
    const antes = d.chamadas.length
    expect((await drive.pastaDoProjeto({ id: 'caso-silva', nome: 'x', pasta })).nova).toBe(false)
    expect(d.chamadas.slice(antes)).toEqual([`GET /drive/v3/files/${pasta.id}`])
  })

  it('pasta guardada que foi para a lixeira ou sumiu é trocada por uma nova', async () => {
    const d = driveFalso()
    const drive = criarDriveDosProjetos(d.request)
    const { pasta } = await drive.pastaDoProjeto({ id: 'p', nome: 'P' })
    d.arquivos.find((a) => a.id === pasta.id).trashed = true
    const depois = await drive.pastaDoProjeto({ id: 'p', nome: 'P', pasta })
    expect(depois.nova).toBe(true)
    expect(depois.pasta.id).not.toBe(pasta.id)
    expect((await drive.pastaDoProjeto({ id: 'p', nome: 'P', pasta: { id: 'nao-existe' } })).nova).toBe(true)
  })

  it('cria Documento direto na pasta', async () => {
    const d = driveFalso()
    const drive = criarDriveDosProjetos(d.request)
    const f = await drive.criarArquivoGoogle('pasta1', 'Ata', 'application/vnd.google-apps.document')
    expect(d.arquivos.find((a) => a.id === f.id)).toMatchObject({ name: 'Ata', mimeType: 'application/vnd.google-apps.document', parents: ['pasta1'] })
  })
})
