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

  it('tarefa com etiqueta nova cria a ficha do projeto, sem mexer na que já existe', async () => {
    const r = await f.criarTarefa(api, agora, { titulo: 'Revisar POP', projeto: 'POPs novos' })
    expect(r).toContain('Projeto novo')
    let fichas = await api.drive.loadProjetos()
    expect(fichas.map((p) => p.id)).toEqual(['pops-novos'])
    await f.atualizarProjeto(api, agora, { projeto: 'pops-novos', resultado: 'POPs revisados' })
    const r2 = await f.criarTarefa(api, agora, { titulo: 'Outra', projeto: 'pops-novos' })
    expect(r2).not.toContain('Projeto novo')
    fichas = await api.drive.loadProjetos()
    expect(fichas).toHaveLength(1)
    expect(fichas[0].resultado).toBe('POPs revisados')
  })

  it('listar_projetos avisa projeto concluído com pendências', async () => {
    await f.criarTarefa(api, agora, { titulo: 'Sobrou', projeto: 'pops' })
    await f.atualizarProjeto(api, agora, { projeto: 'pops', situacao: 'concluido' })
    expect(await f.listarProjetosTexto(api, agora, { situacao: 'todos' })).toMatch(/concluído, mas com 1 pendente/)
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

describe('base de conhecimento', () => {
  const chave = (t) => t.toLowerCase()
  const nota = (id, title, body, extra = {}) => ({ id, title, body, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-29T10:00:00.000Z', ...extra })

  it('importar_fonte cria a nota da fonte e uma por ideia, ligadas e com a fonte, numa gravação só', async () => {
    g.gravarArquivo('anotacoes.json', { notes: [nota('a', 'Do app', 'escrita no app')], deleted: [] })
    const r = await f.importarFonte(api, agora, {
      fonte: { titulo: 'Tipificação dos serviços', url: 'mds.gov.br/tipificacao', autor: 'MDS', data: '2009-11-11' },
      resumo: 'Documento que padroniza os serviços socioassistenciais.',
      notas: [
        { titulo: 'PAIF', texto: 'Serviço de proteção e atendimento integral à família.' },
        { titulo: 'PAEFI', texto: 'Atendimento especializado, ligado ao [[PAIF]].' },
      ],
      projeto: 'Imersão AEPETI',
    })
    const { notes } = g.lerArquivo('anotacoes.json')
    const porTitulo = Object.fromEntries(notes.map((n) => [n.title, n]))
    expect(Object.keys(porTitulo).sort()).toEqual(['Do app', 'PAEFI', 'PAIF', 'Tipificação dos serviços'])
    expect(porTitulo['Tipificação dos serviços'].body).toContain('- [[PAIF]]\n- [[PAEFI]]')
    expect(porTitulo.PAIF.body).toMatch(/Fonte: \[\[Tipificação dos serviços\]\]$/)
    expect(porTitulo.PAIF.fontes).toEqual([{ titulo: 'Tipificação dos serviços', url: 'https://mds.gov.br/tipificacao', autor: 'MDS', data: '2009-11-11' }])
    expect(porTitulo.PAIF.projeto).toBe('imersao-aepeti')
    expect(r).toMatch(/Notas criadas \(3\)/)
  })

  it('ideia com título de nota existente é somada a ela, sem duplicar e sem perder a fonte antiga', async () => {
    g.gravarArquivo('anotacoes.json', {
      notes: [nota('p', 'paif', 'O que eu já sabia.', { fontes: [{ titulo: 'Curso' }] })],
      deleted: [],
    })
    const r = await f.importarFonte(api, agora, {
      fonte: { titulo: 'Caderno de orientações' },
      resumo: 'Orientações técnicas.',
      notas: [{ titulo: 'PAIF', texto: 'Acompanhamento familiar em grupo.' }],
    })
    const { notes } = g.lerArquivo('anotacoes.json')
    expect(notes).toHaveLength(2)
    const paif = notes.find((n) => n.id === 'p')
    expect(paif.body).toBe('O que eu já sabia.\n\nAcompanhamento familiar em grupo.\n\nFonte: [[Caderno de orientações]]')
    expect(paif.fontes.map((x) => x.titulo)).toEqual(['Curso', 'Caderno de orientações'])
    expect(r).toMatch(/receberam o conteúdo novo no fim \(1\):\n- paif \[nota: p\]/)
  })

  it('ler_nota mostra fontes, para onde a nota liga e quem a cita', async () => {
    g.gravarArquivo('anotacoes.json', {
      notes: [
        nota('a', 'Audiência', 'Ver [[Caso Silva]] e [[Ofício]].', { fontes: [{ titulo: 'Intimação', data: '2026-10-20' }] }),
        nota('b', 'Caso Silva', 'Família acompanhada.'),
        nota('c', 'Reunião', 'Falamos da [[audiencia]].'),
      ],
      deleted: [],
    })
    const texto = await f.lerNota(api, agora, { id: 'a' })
    expect(texto).toContain('Fontes:\n- Intimação (ter. 20/10/2026)')
    expect(texto).toContain('Liga a:\n- Caso Silva [nota: b]\n- Ofício (ainda não existe)')
    expect(texto).toContain('Citada por:\n- Reunião [nota: c]')
  })

  it('criar_nota e atualizar_nota registram fontes, somando sem repetir', async () => {
    await f.criarNota(api, agora, { titulo: 'Lei', texto: 'texto', fontes: [{ titulo: 'LOAS', url: 'planalto.gov.br' }] })
    const [criada] = g.lerArquivo('anotacoes.json').notes
    expect(criada.fontes).toEqual([{ titulo: 'LOAS', url: 'https://planalto.gov.br/' }])
    await f.atualizarNota(api, agora, { id: criada.id, fontes: [{ titulo: 'loas' }, { titulo: 'Decreto' }] })
    expect(g.lerArquivo('anotacoes.json').notes[0].fontes.map((x) => x.titulo)).toEqual(['LOAS', 'Decreto'])
  })

  it('buscar_notas acha por palavras soltas, em ordem de relevância, e aponta as notas vizinhas', async () => {
    g.gravarArquivo('anotacoes.json', {
      notes: [
        nota('a', 'Recursos para PSR', 'O edital da prefeitura abre em março. Detalhes em [[Fundo estadual]].'),
        nota('b', 'Reunião de equipe', 'Falamos do edital de compras, de passagem.'),
        nota('f', 'Fundo estadual', 'Repasse anual, inscrição até abril.'),
        nota('m', 'Mercado', 'arroz'),
      ],
      deleted: [],
    })
    const texto = await f.buscarNotas(api, agora, { texto: 'editais população rua PSR' })
    expect(texto.indexOf('[nota: a]')).toBeLessThan(texto.indexOf('[nota: b]'))
    expect(texto).toContain('liga a: [[Fundo estadual]]')
    expect(texto).toMatch(/Ligadas a esses resultados[^]*Fundo estadual \[nota: f\]/)
    expect(texto).not.toContain('[nota: m]')
  })

  it('atualizar_nota com título novo leva junto os links das outras notas', async () => {
    g.gravarArquivo('anotacoes.json', {
      notes: [nota('a', 'Caso Silva', 'texto'), nota('b', 'Audiência', 'Ver [[Caso Silva|o caso]].')],
      deleted: [],
    })
    const r = await f.atualizarNota(api, agora, { id: 'a', titulo: 'Família Silva' })
    const { notes } = g.lerArquivo('anotacoes.json')
    expect(notes.find((n) => n.id === 'b').body).toBe('Ver [[Família Silva|o caso]].')
    expect(r).toMatch(/Links atualizados para o título novo em 1 nota/)
  })

  it('guardar_resposta cria a nota ligada às notas de origem, e soma se o título já existir', async () => {
    g.gravarArquivo('anotacoes.json', {
      notes: [nota('a', 'Recursos para PSR', 'edital'), nota('f', 'Fundo estadual', 'repasse')],
      deleted: [],
    })
    const r = await f.guardarResposta(api, agora, { titulo: 'Editais abertos', resposta: 'Dois: o da prefeitura e o estadual.', baseada_em: ['a', 'f', 'a'] })
    let { notes } = g.lerArquivo('anotacoes.json')
    const guardada = notes.find((n) => n.title === 'Editais abertos')
    expect(guardada.body).toBe('Dois: o da prefeitura e o estadual.\n\nBaseada em: [[Recursos para PSR]], [[Fundo estadual]]')
    expect(r).toMatch(/ligada a 2 notas/)

    await f.guardarResposta(api, agora, { titulo: 'editais abertos', resposta: 'Abriu mais um.' })
    ;({ notes } = g.lerArquivo('anotacoes.json'))
    expect(notes.filter((n) => chave(n.title) === 'editais abertos')).toHaveLength(1)
    expect(notes.find((n) => n.id === guardada.id).body).toMatch(/\n\nsex\. 30\/10\/2026:\nAbriu mais um\.$/)

    await expect(f.guardarResposta(api, agora, { titulo: 'x', resposta: 'y', baseada_em: ['inventado'] })).rejects.toThrow(/Não existe anotação/)
  })

  it('saude_das_notas aponta link quebrado, nota solta e título repetido', async () => {
    g.gravarArquivo('anotacoes.json', {
      notes: [nota('a', 'Audiência', 'Ver [[Não existe]]'), nota('b', 'Solta', 'sozinha'), nota('c', 'solta', 'outra')],
      deleted: [],
    })
    const texto = await f.saudeDasNotasTexto(api)
    expect(texto).toContain('## Links para notas que não existem: 1\n- em Audiência [nota: a]: [[Não existe]]')
    expect(texto).toMatch(/## Títulos repetidos .*: 1\n- "Solta": \[nota: b\], \[nota: c\]/)
  })
})
