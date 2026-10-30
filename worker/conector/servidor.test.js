import { describe, expect, it } from 'vitest'
import { createMcpHandler } from 'agents/mcp/server'
import { criarApiDeTarefas } from '../../src/lib/googleTarefas.js'
import { criarApiDaAgenda } from '../../src/lib/googleAgenda.js'
import { criarArmazemNoDrive } from '../../src/lib/driveArquivos.js'
import { googleFalso } from '../teste/googleFalso.js'
import { ESQUEMAS, NOMES_DAS_FERRAMENTAS, criarServidor, executarFerramenta } from './servidor.js'

const agora = new Date('2026-10-30T17:00:00Z')

describe('validação dos argumentos (o Claude também pode mandar lixo)', () => {
  it('recusa data inexistente, formato errado e lista desconhecida', () => {
    expect(ESQUEMAS.criar_tarefa.safeParse({ titulo: 'x', prazo: '2026-02-30' }).success).toBe(false)
    expect(ESQUEMAS.criar_tarefa.safeParse({ titulo: 'x', prazo: '30/10/2026' }).success).toBe(false)
    expect(ESQUEMAS.criar_tarefa.safeParse({ titulo: 'x', lista: 'urgente' }).success).toBe(false)
    expect(ESQUEMAS.criar_tarefa.safeParse({ titulo: 'x', prioridade: 'urgentissima' }).success).toBe(false)
    expect(ESQUEMAS.criar_evento.safeParse({ titulo: 'x', data: '2026-10-30', inicio: '25:00' }).success).toBe(false)
  })

  it('recusa texto vazio ou só espaços e números fora da faixa', () => {
    expect(ESQUEMAS.capturar.safeParse({ texto: '   ' }).success).toBe(false)
    expect(ESQUEMAS.listar_tarefas.safeParse({ limite: 0 }).success).toBe(false)
    expect(ESQUEMAS.criar_tarefa.safeParse({ titulo: 'x', duracao_min: -5 }).success).toBe(false)
  })

  it('aceita o que é válido, com os padrões preenchidos', () => {
    expect(ESQUEMAS.criar_tarefa.parse({ titulo: '  Ligar  ' })).toMatchObject({ titulo: 'Ligar', lista: 'proximas' })
    expect(ESQUEMAS.atualizar_tarefa.parse({ id: 't1', prazo: null, contexto: null })).toMatchObject({ prazo: null, contexto: null })
    expect(ESQUEMAS.atualizar_nota.parse({ id: 'n1', texto: 'mais' }).modo).toBe('acrescentar')
  })
})

// O protocolo MCP de verdade, pelo mesmo handler do Agents SDK que o Worker
// usa, com o Google falso por baixo.
function servidorDeTeste() {
  const g = googleFalso({ agora: () => agora })
  g.criarLista('Entrada')
  const api = { tarefas: criarApiDeTarefas(g.request), agenda: criarApiDaAgenda(g.request), drive: criarArmazemNoDrive(g.request) }
  const handler = createMcpHandler(() => criarServidor({}, { email: 'eu@exemplo.com' }, { api, agora: () => agora }), { route: '/mcp' })
  let id = 0
  async function rpc(method, params = {}) {
    const res = await handler(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          Host: 'localhost',
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-06-18',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      }),
      {},
      { props: { email: 'eu@exemplo.com' } }
    )
    const texto = await res.text()
    const dados = texto.split('\n').find((l) => l.startsWith('data: '))
    return JSON.parse(dados ? dados.slice(6) : texto)
  }
  return { g, rpc }
}

describe('servidor MCP', () => {
  it('se apresenta com as instruções do método', async () => {
    const { rpc } = servidorDeTeste()
    const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } })
    expect(r.result.serverInfo.name).toBe('segundo-cerebro')
    expect(r.result.instructions).toMatch(/visao_geral/)
    expect(r.result.instructions).toMatch(/capturar/)
  })

  it('lista as ferramentas, com leitura marcada como só leitura', async () => {
    const { rpc } = servidorDeTeste()
    const { result } = await rpc('tools/list')
    const porNome = Object.fromEntries(result.tools.map((t) => [t.name, t]))
    expect(Object.keys(porNome).sort()).toEqual([...NOMES_DAS_FERRAMENTAS].sort())
    expect(porNome.visao_geral.annotations.readOnlyHint).toBe(true)
    expect(porNome.buscar_notas.annotations.readOnlyHint).toBe(true)
    expect(porNome.capturar.annotations.readOnlyHint).toBe(false)
    expect(porNome.capturar.annotations.destructiveHint).toBe(false)
    expect(NOMES_DAS_FERRAMENTAS.some((n) => /exclu|apag|delet/.test(n))).toBe(false)
    expect(porNome.criar_tarefa.inputSchema.properties.lista.enum).toEqual(['entrada', 'proximas', 'aguardando', 'algum_dia'])
  })

  it('executa uma ferramenta e grava no formato do app', async () => {
    const { g, rpc } = servidorDeTeste()
    const r = await rpc('tools/call', { name: 'capturar', arguments: { texto: 'comprar presente' } })
    expect(r.result.isError).toBeFalsy()
    expect(r.result.content[0].text).toMatch(/Guardado na Entrada/)
    expect(g.estado.tarefas[0]).toMatchObject({ title: 'comprar presente', notes: '[media]' })
  })

  it('argumento inválido não chega a mexer em nada', async () => {
    const { g, rpc } = servidorDeTeste()
    const r = await rpc('tools/call', { name: 'criar_evento', arguments: { titulo: 'x', data: '30/10/2026' } })
    const falhou = Boolean(r.error) || r.result?.isError === true
    expect(falhou).toBe(true)
    expect(g.estado.eventos).toHaveLength(0)
  })
})

describe('erros traduzidos para o Claude', () => {
  it('API do Drive desligada vira instrução clara, e erro de uso volta como está', async () => {
    const drive = {
      loadNotes: async () => {
        const err = new Error('403')
        err.status = 403
        err.body = JSON.stringify({ error: { message: 'Google Drive API has not been used in project 123 before or it is disabled.' } })
        throw err
      },
    }
    const r = await executarFerramenta('buscar_notas', { texto: 'x' }, { api: { drive }, agora })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/Google Drive API/)
    const g = googleFalso()
    const api = { tarefas: criarApiDeTarefas(g.request) }
    const uso = await executarFerramenta('concluir_tarefa', { id: 'nada' }, { api, agora })
    expect(uso.content[0].text).toMatch(/Não existe tarefa/)
  })
})
