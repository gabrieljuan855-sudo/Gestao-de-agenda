import { beforeEach, describe, expect, it } from 'vitest'
import { criarApiDeTarefas } from '../../src/lib/googleTarefas.js'
import { criarApiDaAgenda } from '../../src/lib/googleAgenda.js'
import { criarArmazemNoDrive } from '../../src/lib/driveArquivos.js'
import { parseMeta } from '../../src/lib/gtd.js'
import { PROJETO_PROP } from '../../src/lib/projetos.js'
import { googleFalso } from '../teste/googleFalso.js'
import * as f from './ferramentas.js'

// Sexta-feira, 30/10/2026, 14h em Brasília.
const agora = new Date('2026-10-30T17:00:00Z')

let g
let api
let listas

beforeEach(() => {
  g = googleFalso({ agora: () => agora })
  api = { tarefas: criarApiDeTarefas(g.request), agenda: criarApiDaAgenda(g.request), drive: criarArmazemNoDrive(g.request) }
  listas = {
    entrada: g.criarLista('Entrada'),
    proximas: g.criarLista('Próximas ações'),
    aguardando: g.criarLista('Aguardando'),
    algumDia: g.criarLista('Algum dia'),
  }
})

const tarefasNa = (lista) => g.estado.tarefas.filter((t) => t.tasklistId === lista.id)

describe('bloco de metadados nas tarefas', () => {
  it('capturar grava o texto cru na Entrada, no formato do app', async () => {
    const r = await f.capturar(api, agora, { texto: '  ligar pro dentista  ' })
    const [t] = tarefasNa(listas.entrada)
    expect(t.title).toBe('ligar pro dentista')
    expect(t.notes).toBe('[media]')
    expect(r).toContain(t.id)
  })

  it('criar_tarefa monta o bloco [prioridade @contexto #projeto ~quem desde: min:]', async () => {
    await f.criarTarefa(api, agora, {
      titulo: 'Cobrar o laudo',
      lista: 'aguardando',
      contexto: 'Ligação',
      projeto: 'Caso Silva',
      prioridade: 'alta',
      prazo: '2026-11-03',
      duracao_min: 15,
      aguardando_quem: 'Ana',
      notas: 'pediu até sexta',
    })
    const [t] = tarefasNa(listas.aguardando)
    expect(t.notes).toBe('[alta @ligacao #caso-silva ~ana desde:2026-10-30 min:15] pediu até sexta')
    expect(t.due).toBe('2026-11-03T00:00:00.000Z')
  })

  it('aguardando sem "de quem" é recusado', async () => {
    await expect(f.criarTarefa(api, agora, { titulo: 'x', lista: 'aguardando' })).rejects.toThrow(/aguardando_quem/)
  })

  it('listar_tarefas lê o bloco e mostra contexto, projeto, prazo e atraso', async () => {
    g.criarTarefa(listas.proximas.id, { title: 'Enviar ofício', notes: '[alta @computador #caso-silva min:30] rascunho no drive', due: '2026-10-28T00:00:00.000Z' })
    g.criarTarefa(listas.proximas.id, { title: 'Comprar café', notes: '[baixa @rua]' })
    const texto = await f.listarTarefas(api, agora, { lista: 'proximas' })
    expect(texto).toMatch(/Enviar ofício · Alta · @computador · #caso-silva · prazo qua\. 28\/10\/2026 \(atrasada há 2 dias\) · 30 min/)
    expect(texto.indexOf('Enviar ofício')).toBeLessThan(texto.indexOf('Comprar café'))
    const soRua = await f.listarTarefas(api, agora, { contexto: '@rua' })
    expect(soRua).toContain('Comprar café')
    expect(soRua).not.toContain('Enviar ofício')
  })

  it('cabe_em_minutos deixa de fora só o que é maior (sem estimativa entra)', async () => {
    g.criarTarefa(listas.proximas.id, { title: 'Longa', notes: '[media min:90]' })
    g.criarTarefa(listas.proximas.id, { title: 'Sem estimativa', notes: '[media]' })
    const texto = await f.listarTarefas(api, agora, { cabe_em_minutos: 30 })
    expect(texto).toContain('Sem estimativa')
    expect(texto).not.toContain('Longa')
  })

  it('atualizar_tarefa esclarece um item da Entrada movendo de lista e mantém o bloco', async () => {
    const t = g.criarTarefa(listas.entrada.id, { title: 'dentista', notes: '[media]' })
    const r = await f.atualizarTarefa(api, agora, { id: t.id, lista: 'proximas', titulo: 'Ligar para o dentista e marcar limpeza', contexto: 'ligar' })
    expect(r).toMatch(/de Entrada para Próximas ações/)
    const movida = tarefasNa(listas.proximas)[0]
    expect(movida.title).toBe('Ligar para o dentista e marcar limpeza')
    expect(parseMeta(movida.notes)).toMatchObject({ priority: 'media', contexto: 'ligar' })
  })

  it('sair de Aguardando encerra a espera; mudar só a prioridade não mexe no resto', async () => {
    const t = g.criarTarefa(listas.aguardando.id, { title: 'Laudo', notes: '[media @ligar ~ana desde:2026-10-01] obs' })
    await f.atualizarTarefa(api, agora, { id: t.id, prioridade: 'alta' })
    expect(g.estado.tarefas[0].notes).toBe('[alta @ligar ~ana desde:2026-10-01] obs')
    await f.atualizarTarefa(api, agora, { id: t.id, lista: 'proximas' })
    expect(parseMeta(g.estado.tarefas[0].notes).aguardando).toBeNull()
  })

  it('não cria lista duplicada: acha a existente sem ligar para acento e caixa', async () => {
    g.estado.listas = g.estado.listas.filter((l) => l !== listas.proximas)
    const outra = g.criarLista('proximas acoes')
    await f.criarTarefa(api, agora, { titulo: 'Algo', lista: 'proximas' })
    expect(g.estado.listas.filter((l) => /pr.ximas/i.test(l.title))).toHaveLength(1)
    expect(tarefasNa(outra)).toHaveLength(1)
  })

  it('concluir_tarefa conclui e registra a conclusão na agenda, como o app', async () => {
    const t = g.criarTarefa(listas.proximas.id, { title: 'Pagar boleto', notes: '[alta]' })
    const r = await f.concluirTarefa(api, agora, { id: t.id })
    expect(g.estado.tarefas[0].status).toBe('completed')
    expect(g.estado.eventos[0].summary).toBe('✓ Pagar boleto')
    expect(r).toMatch(/registrada na agenda/)
  })

  it('id inexistente vira erro de uso, com o caminho para achar o certo', async () => {
    await expect(f.concluirTarefa(api, agora, { id: 'nao-existe' })).rejects.toBeInstanceOf(f.ErroDeUso)
  })
})

describe('anotações', () => {
  const notaDoApp = (id, extra = {}) => ({ id, title: `Nota ${id}`, body: 'texto', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-29T10:00:00.000Z', ...extra })

  it('criar_nota não apaga o que o app já tinha gravado, e respeita o rastro de exclusão', async () => {
    g.gravarArquivo('anotacoes.json', {
      notes: [notaDoApp('a'), notaDoApp('b', { projeto: 'caso-silva', fixada: true })],
      deleted: [{ id: 'apagada', at: '2026-10-29T12:00:00.000Z' }],
    })
    await f.criarNota(api, agora, { titulo: 'Visita', texto: 'Família pediu retorno', projeto: 'Caso Silva' })
    const arquivo = g.lerArquivo('anotacoes.json')
    expect(arquivo.notes.map((n) => n.id)).toEqual(expect.arrayContaining(['a', 'b']))
    expect(arquivo.notes).toHaveLength(3)
    const nova = arquivo.notes.find((n) => n.title === 'Visita')
    expect(nova).toMatchObject({ body: 'Família pediu retorno', projeto: 'caso-silva', createdAt: agora.toISOString() })
    expect(arquivo.notes.find((n) => n.id === 'b')).toMatchObject({ projeto: 'caso-silva', fixada: true })
    expect(arquivo.deleted).toEqual([{ id: 'apagada', at: '2026-10-29T12:00:00.000Z' }])
  })

  it('primeira nota sem arquivo no Drive cria o arquivo no formato do app', async () => {
    await f.criarNota(api, agora, { texto: 'primeira' })
    expect(g.lerArquivo('anotacoes.json')).toMatchObject({ notes: [{ body: 'primeira', title: '' }], deleted: [] })
  })

  it('atualizar_nota acrescenta ao fim sem reescrever, e substitui quando pedido', async () => {
    g.gravarArquivo('anotacoes.json', { notes: [notaDoApp('a', { body: 'linha 1\n' })], deleted: [] })
    await f.atualizarNota(api, agora, { id: 'a', texto: 'linha 2', modo: 'acrescentar' })
    expect(g.lerArquivo('anotacoes.json').notes[0]).toMatchObject({ body: 'linha 1\n\nlinha 2', updatedAt: agora.toISOString() })
    // A segunda edição cai no mesmo instante (relógio fixo) e ainda assim vale.
    await f.atualizarNota(api, agora, { id: 'a', texto: 'só isto', modo: 'substituir' })
    expect(g.lerArquivo('anotacoes.json').notes[0].body).toBe('só isto')
  })

  it('buscar_notas acha sem acento nem caixa, com trecho e id', async () => {
    g.gravarArquivo('anotacoes.json', { notes: [notaDoApp('a', { body: 'Reunião com a família\nAudiência em dezembro' })], deleted: [] })
    const texto = await f.buscarNotas(api, agora, { texto: 'AUDIENCIA' })
    expect(texto).toContain('[nota: a]')
    expect(texto).toContain('Audiência em dezembro')
    expect(await f.buscarNotas(api, agora, { texto: 'inexistente' })).toMatch(/Nenhuma anotação/)
  })
})

describe('projetos', () => {
  it('criar_projeto grava a ficha com a etiqueta como id, mesclando com as do app', async () => {
    g.gravarArquivo('projetos.json', { projetos: [{ id: 'reuniao', nome: 'Reunião', tipo: 'rotina', situacao: 'ativo', updatedAt: '2026-10-01T00:00:00.000Z' }] })
    const r = await f.criarProjeto(api, agora, { nome: 'Caso Silva', resultado: 'Família acolhida', tipo: 'projeto', situacao: 'ativo' })
    expect(r).toContain('[projeto: caso-silva]')
    const { projetos } = g.lerArquivo('projetos.json')
    expect(projetos.map((p) => p.id).sort()).toEqual(['caso-silva', 'reuniao'])
    expect(projetos.find((p) => p.id === 'caso-silva')).toMatchObject({ nome: 'Caso Silva', resultado: 'Família acolhida', arquivos: [] })
    await expect(f.criarProjeto(api, agora, { nome: 'caso silva' })).rejects.toThrow(/Já existe/)
  })

  it('atualizar_projeto dá ficha a uma etiqueta solta e muda a situação', async () => {
    const r = await f.atualizarProjeto(api, agora, { projeto: 'caso-maria', situacao: 'pausado' })
    expect(r).toMatch(/Ficha criada/)
    expect(g.lerArquivo('projetos.json').projetos[0]).toMatchObject({ id: 'caso-maria', situacao: 'pausado' })
  })

  it('ver_projeto junta ficha, tarefas, notas e compromissos, e cobra projeto sem próxima ação', async () => {
    g.gravarArquivo('projetos.json', { projetos: [{ id: 'caso-silva', nome: 'Caso Silva', resultado: 'Família acolhida', situacao: 'ativo' }] })
    g.gravarArquivo('anotacoes.json', { notes: [{ id: 'n1', title: 'Visita', body: 'Relato da visita', projeto: 'caso-silva', createdAt: agora.toISOString(), updatedAt: agora.toISOString() }], deleted: [] })
    g.criarTarefa(listas.aguardando.id, { title: 'Laudo do CREAS', notes: '[media #caso-silva ~ana desde:2026-10-01]' })
    g.estado.eventos.push({ id: 'e1', calendarId: 'primary', status: 'confirmed', summary: 'Audiência', start: { dateTime: '2026-11-05T13:00:00Z' }, end: { dateTime: '2026-11-05T14:00:00Z' }, extendedProperties: { private: { [PROJETO_PROP]: 'caso-silva' } } })
    const texto = await f.verProjeto(api, agora, { projeto: 'Caso Silva' })
    expect(texto).toContain('Resultado esperado: Família acolhida')
    expect(texto).toContain('ATENÇÃO: projeto ativo sem nenhuma próxima ação.')
    expect(texto).toMatch(/### Aguardando \(1\)\n- Laudo do CREAS/)
    expect(texto).toContain('[nota: n1]')
    expect(texto).toMatch(/qui\. 05\/11 10:00–11:00 Audiência/)
  })
})

describe('agenda e visão geral', () => {
  it('criar_evento grava no fuso de Brasília e liga ao projeto pela marca privada do app', async () => {
    const r = await f.criarEvento(api, agora, { titulo: 'Audiência', data: '2026-11-05', inicio: '14:00', duracao_min: 90, projeto: 'Caso Silva' })
    const e = g.estado.eventos[0]
    expect(e.start.dateTime).toBe('2026-11-05T17:00:00.000Z')
    expect(e.end.dateTime).toBe('2026-11-05T18:30:00.000Z')
    expect(e.extendedProperties.private[PROJETO_PROP]).toBe('caso-silva')
    expect(r).toMatch(/qui\. 05\/11\/2026, 14:00–15:30/)
  })

  it('criar_evento de dia inteiro usa a data exclusiva do Google', async () => {
    await f.criarEvento(api, agora, { titulo: 'Férias', data: '2026-11-10', data_fim: '2026-11-12', dia_inteiro: true })
    expect(g.estado.eventos[0]).toMatchObject({ start: { date: '2026-11-10' }, end: { date: '2026-11-13' } })
  })

  it('agenda mostra o dia com os vãos livres do expediente, descontando os compromissos', async () => {
    g.estado.eventos.push({ id: 'e1', calendarId: 'primary', status: 'confirmed', summary: 'Reunião', start: { dateTime: '2026-10-30T12:00:00Z' }, end: { dateTime: '2026-10-30T13:30:00Z' } })
    const texto = await f.agenda(api, agora, {})
    expect(texto).toContain('09:00–10:30 Reunião')
    // Sexta: expediente padrão das 7h30 às 13h30.
    expect(texto).toContain('vãos livres no expediente: 07:30–09:00, 10:30–13:30')
  })

  it('visao_geral junta Entrada, prioridades, atrasadas, esperas longas, projetos parados e o dia', async () => {
    g.criarTarefa(listas.entrada.id, { title: 'ideia solta', notes: '' })
    g.criarTarefa(listas.proximas.id, { title: 'Relatório', notes: '[alta]', due: '2026-10-27T00:00:00.000Z' })
    g.criarTarefa(listas.proximas.id, { title: 'Arquivar', notes: '[baixa]' })
    g.criarTarefa(listas.aguardando.id, { title: 'Resposta do juiz', notes: '[media #caso-silva ~vara desde:2026-10-10]' })
    g.estado.eventos.push({ id: 'e1', calendarId: 'primary', status: 'confirmed', summary: 'Visita domiciliar', start: { dateTime: '2026-10-31T13:00:00Z' }, end: { dateTime: '2026-10-31T15:00:00Z' } })
    const texto = await f.visaoGeral(api, agora)
    expect(texto).toContain('Agora: sexta-feira, 30/10/2026, 14:00')
    expect(texto).toContain('## Entrada: 1 item para esclarecer')
    expect(texto).toContain('## Próximas ações: 2 (alta 1, média 0, baixa 1)')
    expect(texto).toMatch(/## Atrasadas: 1\n- Relatório/)
    expect(texto).toMatch(/## Aguardando há mais de 7 dias: 1\n- Resposta do juiz · com vara · há 20 dias/)
    expect(texto).toMatch(/## Projetos ativos sem próxima ação: 1\n- caso-silva/)
    expect(texto).toMatch(/sábado, 31\/10\/2026:\n- 10:00–12:00 Visita domiciliar/)
  })
})
