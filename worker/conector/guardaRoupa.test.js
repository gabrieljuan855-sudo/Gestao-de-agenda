import { beforeEach, describe, expect, it } from 'vitest'
import { createMcpHandler } from 'agents/mcp/server'
import { criarArmazemNoDrive } from '../../src/lib/driveArquivos.js'
import { novaPeca, registrarFeedback, mesclarGuardaRoupa, normalizarGuardaRoupa } from '../../src/lib/guardaRoupa.js'
import { googleFalso } from '../teste/googleFalso.js'
import { ErroDeUso } from './ferramentas.js'
import { criarServidor, ESQUEMAS } from './servidor.js'
import * as gr from './guardaRoupa.js'

// Segunda-feira, 16/11/2026, 7h em Brasília — a hora da rotina da manhã.
const agora = new Date('2026-11-16T10:00:00Z')
// Os primeiros bytes de um JPEG; basta para conferir que a foto volta inteira.
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]

let g
let api

beforeEach(() => {
  g = googleFalso({ agora: () => agora })
  api = { drive: criarArmazemNoDrive(g.request), fotos: g.fotos }
})

// Uma peça cadastrada como o app cadastra: foto no Drive, sem classificação.
async function cadastrarNoApp(campos = {}, quando = new Date('2026-11-10T12:00:00Z')) {
  const driveId = g.gravarFoto(JPEG)
  const peca = novaPeca({ foto: { driveId, url: `https://drive.google.com/file/d/${driveId}` }, ...campos }, quando)
  const atual = normalizarGuardaRoupa(await api.drive.loadGuardaRoupa())
  await api.drive.saveGuardaRoupa({ ...atual, pecas: [peca, ...atual.pecas] })
  return peca
}
const noDrive = () => g.lerArquivo('guarda-roupa.json')

describe('classificar as peças', () => {
  it('lista a pendente, mostra a foto como imagem e classifica', async () => {
    const peca = await cadastrarNoApp()
    const lista = await gr.listarGuardaRoupa(api, agora, { status: 'pendente' })
    expect(lista).toContain(`[peça: ${peca.id}]`)
    expect(lista).toContain('PENDENTE')
    expect(lista).toContain('nunca usada (cadastrada há 6 dias)')

    const vista = await gr.verPeca(api, agora, { id: peca.id })
    expect(vista.content[0]).toMatchObject({ type: 'text' })
    expect(vista.content[1]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' })
    expect([...Uint8Array.from(atob(vista.content[1].data), (c) => c.charCodeAt(0))]).toEqual(JPEG)

    const r = await gr.atualizarPeca(api, agora, { id: peca.id, nome: 'Camisa de linho azul', categoria: 'parte-de-cima', cor: 'azul-claro', ocasioes: ['trabalho', 'casual'], temperaturas: ['calor', 'ameno'] })
    expect(r).toContain('Camisa de linho azul')
    const [gravada] = noDrive().pecas
    expect(gravada).toMatchObject({ status: 'classificada', nome: 'Camisa de linho azul', categoria: 'parte-de-cima', ocasioes: ['trabalho', 'casual'], temperaturas: ['ameno', 'calor'] })
    expect(gravada.foto).toEqual(peca.foto)
    expect(await gr.listarGuardaRoupa(api, agora, { status: 'pendente' })).toContain('Nenhuma peça com esse filtro')
  })

  it('a edição do conector ganha da versão lida, mesmo com o relógio do aparelho adiantado', async () => {
    const peca = await cadastrarNoApp({}, new Date('2026-11-16T10:05:00Z'))
    await gr.atualizarPeca(api, agora, { id: peca.id, nome: 'Tênis branco' })
    expect(noDrive().pecas[0].nome).toBe('Tênis branco')
  })

  it('foto que sumiu do Drive: os dados vêm, com o aviso', async () => {
    const peca = await cadastrarNoApp()
    g.estado.arquivos.find((a) => a.id === peca.foto.driveId).trashed = true
    const vista = await gr.verPeca(api, agora, { id: peca.id }, { traduzirErro: () => 'o arquivo não existe mais' })
    expect(vista).toContain('Não deu para trazer a foto: o arquivo não existe mais')
  })

  it('id que não existe é erro de uso, e o filtro recusa categoria inventada', async () => {
    await expect(gr.verPeca(api, agora, { id: 'nada' })).rejects.toBeInstanceOf(ErroDeUso)
    expect(ESQUEMAS.listar_guarda_roupa.safeParse({ categoria: 'chapeu' }).success).toBe(false)
    expect(ESQUEMAS.atualizar_peca.safeParse({ id: 'a', ocasioes: ['balada'] }).success).toBe(false)
    expect(ESQUEMAS.registrar_feedback_look.safeParse({ feedback: 'amei' }).success).toBe(false)
    expect(ESQUEMAS.salvar_look_do_dia.safeParse({ pecas: [], texto: 'x' }).success).toBe(false)
  })

  it('guarda-roupa vazio diz onde as peças são cadastradas', async () => {
    expect(await gr.listarGuardaRoupa(api, agora, {})).toContain('cadastradas pela pessoa no app')
  })
})

describe('look do dia', () => {
  let camisa
  let calca
  let tenis
  beforeEach(async () => {
    camisa = await cadastrarNoApp({ nome: 'Camisa azul', categoria: 'parte-de-cima', ocasioes: ['trabalho'] })
    calca = await cadastrarNoApp({ nome: 'Calça bege', categoria: 'parte-de-baixo', ocasioes: ['trabalho'] })
    tenis = await cadastrarNoApp({ nome: 'Tênis branco', categoria: 'calcado', ocasioes: ['casual'] })
  })

  it('salva o look de hoje, mostra de volta e substitui se já houver', async () => {
    expect(await gr.verLookDoDia(api, agora, {})).toContain('Não há look salvo')
    const r = await gr.salvarLookDoDia(api, agora, { pecas: [camisa.id, calca.id], texto: 'Reunião à tarde', clima: '20–28 °C, sol' })
    expect(r).toContain('Look salvo')
    expect(noDrive().looks[0]).toMatchObject({ data: '2026-11-16', pecas: [camisa.id, calca.id], texto: 'Reunião à tarde', clima: '20–28 °C, sol', feedback: '' })
    const visto = await gr.verLookDoDia(api, agora, {})
    expect(visto).toContain('Camisa azul')
    expect(visto).toContain('Clima: 20–28 °C, sol')
    expect(visto).toContain('ainda sem resposta')

    const r2 = await gr.salvarLookDoDia(api, agora, { pecas: [camisa.id, calca.id, tenis.id], texto: 'Com tênis' })
    expect(r2).toContain('Look substituído')
    expect(noDrive().looks).toHaveLength(1)
    expect(noDrive().looks[0].pecas).toHaveLength(3)
  })

  it('recusa peça desativada ou inexistente, sem gravar nada', async () => {
    await gr.atualizarPeca(api, agora, { id: tenis.id, ativa: false })
    await expect(gr.salvarLookDoDia(api, agora, { pecas: [tenis.id], texto: 'x' })).rejects.toThrow(/desativada/)
    await expect(gr.salvarLookDoDia(api, agora, { pecas: ['nada'], texto: 'x' })).rejects.toBeInstanceOf(ErroDeUso)
    expect(noDrive().looks).toEqual([])
  })

  it('"usei" pelo conector faz o mesmo que o botão do app, sem contar duas vezes', async () => {
    await gr.salvarLookDoDia(api, agora, { pecas: [camisa.id, calca.id], texto: 'x' })
    const r = await gr.registrarFeedbackLook(api, agora, { feedback: 'usei' })
    expect(r).toContain('Cada peça do look ganhou um uso')
    const doConector = noDrive()
    const porId = Object.fromEntries(doConector.pecas.map((p) => [p.id, p]))
    expect(porId[camisa.id]).toMatchObject({ usos: 1, ultimoUso: '2026-11-16' })
    expect(porId[tenis.id]).toMatchObject({ usos: 0, ultimoUso: null })

    // O botão do app é registrarFeedback sobre o mesmo estado: dá igual.
    await gr.registrarFeedbackLook(api, agora, { feedback: 'nao_gostei', motivo: 'voltar atrás' })
    const antes = normalizarGuardaRoupa(noDrive())
    const peloApp = registrarFeedback(antes, { data: '2026-11-16', feedback: 'usei' }, agora)
    expect(peloApp.pecas.map((p) => [p.id, p.usos, p.ultimoUso]).sort()).toEqual(doConector.pecas.map((p) => [p.id, p.usos, p.ultimoUso]).sort())

    await gr.registrarFeedbackLook(api, agora, { feedback: 'usei' })
    expect(await gr.registrarFeedbackLook(api, agora, { feedback: 'usei' })).toContain('já estava contado')
    expect(noDrive().pecas.find((p) => p.id === camisa.id).usos).toBe(1)
  })

  it('"não gostei" guarda o motivo e aparece no histórico', async () => {
    await gr.salvarLookDoDia(api, agora, { data: '2026-11-14', pecas: [camisa.id, tenis.id], texto: 'sábado' })
    await gr.registrarFeedbackLook(api, agora, { data: '2026-11-14', feedback: 'nao_gostei', motivo: 'camisa social com tênis ficou estranho' })
    await gr.salvarLookDoDia(api, agora, { data: '2026-10-01', pecas: [calca.id], texto: 'antigo' })
    const h = await gr.historicoLooks(api, agora, { dias: 14 })
    expect(h).toContain('não gostei — camisa social com tênis ficou estranho')
    expect(h).not.toContain('antigo')
    await expect(gr.registrarFeedbackLook(api, agora, { data: '2026-11-15', feedback: 'usei' })).rejects.toThrow(/Não há look salvo/)
  })

  it('não apaga a peça que o app cadastrou entre a leitura e a gravação', async () => {
    const carregar = api.drive.loadGuardaRoupa
    let nova
    let jaChegou = false
    api.drive.loadGuardaRoupa = async () => {
      const lido = await carregar()
      if (!jaChegou) {
        jaChegou = true
        nova = await cadastrarNoApp({ nome: 'Chegou no meio' })
      }
      return lido
    }
    // A leitura devolve o estado de antes do cadastro; quem grava por cima
    // sem mesclar apagaria a peça nova. Aqui a gravação é do app, depois.
    await gr.salvarLookDoDia(api, agora, { pecas: [camisa.id], texto: 'x' })
    const doApp = normalizarGuardaRoupa({ pecas: [nova], looks: [], deleted: [] })
    await api.drive.saveGuardaRoupa(mesclarGuardaRoupa(doApp, normalizarGuardaRoupa(noDrive()), agora.getTime()))
    expect(noDrive().pecas.map((p) => p.nome)).toContain('Chegou no meio')
    expect(noDrive().looks).toHaveLength(1)
  })
})

// O caminho inteiro pelo protocolo MCP: a imagem precisa sair como conteúdo
// "image" de verdade, que é o que deixa o Claude enxergar a peça.
describe('pelo protocolo MCP', () => {
  async function rpc(method, params) {
    const handler = createMcpHandler(() => criarServidor({}, { email: 'eu@exemplo.com' }, { api, agora: () => agora }), { route: '/mcp' })
    const res = await handler(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { Host: 'localhost', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
      {},
      { props: { email: 'eu@exemplo.com' } }
    )
    const texto = await res.text()
    const dados = texto.split('\n').find((l) => l.startsWith('data: '))
    return JSON.parse(dados ? dados.slice(6) : texto)
  }

  it('ver_peca devolve texto e imagem em base64; o fluxo da manhã fecha', async () => {
    const peca = await cadastrarNoApp()
    const vista = await rpc('tools/call', { name: 'ver_peca', arguments: { id: peca.id } })
    expect(vista.result.isError).toBeFalsy()
    expect(vista.result.content.map((c) => c.type)).toEqual(['text', 'image'])
    expect(vista.result.content[1].mimeType).toBe('image/jpeg')
    expect(atob(vista.result.content[1].data).length).toBe(JPEG.length)

    await rpc('tools/call', { name: 'atualizar_peca', arguments: { id: peca.id, nome: 'Vestido verde', categoria: 'parte-de-cima', ocasioes: ['casual'] } })
    const salvo = await rpc('tools/call', { name: 'salvar_look_do_dia', arguments: { pecas: [peca.id], texto: 'Dia quente', clima: '30 °C' } })
    expect(salvo.result.content[0].text).toContain('Look salvo')
    const look = await rpc('tools/call', { name: 'look_do_dia', arguments: {} })
    expect(look.result.content[0].text).toContain('Vestido verde')
    const fb = await rpc('tools/call', { name: 'registrar_feedback_look', arguments: { feedback: 'usei' } })
    expect(fb.result.content[0].text).toContain('Feedback gravado: usei')
    const hist = await rpc('tools/call', { name: 'historico_looks', arguments: {} })
    expect(hist.result.content[0].text).toContain('Feedback: usei')
    expect(noDrive().pecas[0]).toMatchObject({ usos: 1, ultimoUso: '2026-11-16', status: 'classificada' })
  })

  it('erro de uso volta como erro legível', async () => {
    const r = await rpc('tools/call', { name: 'ver_peca', arguments: { id: 'nada' } })
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toContain('listar_guarda_roupa')
  })

  it('as sete ferramentas aparecem, com leitura e escrita marcadas', async () => {
    const { result } = await rpc('tools/list')
    const porNome = Object.fromEntries(result.tools.map((t) => [t.name, t]))
    for (const nome of ['listar_guarda_roupa', 'ver_peca', 'look_do_dia', 'historico_looks']) expect(porNome[nome].annotations.readOnlyHint).toBe(true)
    for (const nome of ['atualizar_peca', 'salvar_look_do_dia', 'registrar_feedback_look']) expect(porNome[nome].annotations.readOnlyHint).toBe(false)
  })
})
