import { describe, expect, it } from 'vitest'
import {
  normalizarProjeto,
  normalizarProjetos,
  novoProjeto,
  listarProjetos,
  tarefasDoProjeto,
  eventoDoProjeto,
  PROJETO_PROP,
  tipoDeArquivo,
  normalizarLink,
  nomeSugerido,
  vincularArquivo,
  panoramaDosProjetos,
  projetosForaDaCobranca,
  pareceIdeia,
  normalizarMarcos,
  adicionarMarco,
  alternarMarco,
  removerMarco,
  proximoMarco,
  historicoDoProjeto,
  juntarConcluidas,
  trechoDaAnotacao,
} from './projetos.js'

const PROXIMAS = 'l-proximas'
const AGUARDANDO = 'l-aguardando'
const ALGUM_DIA = 'l-algum-dia'
const ENTRADA = 'l-entrada'
const agora = new Date('2026-09-29T12:00:00')

describe('novoProjeto', () => {
  it('usa a etiqueta do nome como id, para as tarefas #etiqueta caírem nele sozinhas', () => {
    const p = novoProjeto('Caso Maria', agora)
    expect(p).toMatchObject({ id: 'caso-maria', nome: 'Caso Maria', situacao: 'ativo', resultado: '', prazo: null })
  })

  it('nome que não vira etiqueta nenhuma não vira projeto', () => {
    expect(novoProjeto('   ', agora)).toBe(null)
    expect(novoProjeto('!!!', agora)).toBe(null)
  })
})

describe('normalizarProjeto', () => {
  it('mantém uma ficha válida', () => {
    const p = { id: 'x', nome: 'X', resultado: 'r', situacao: 'pausado', tipo: 'rotina', prazo: '2026-10-01', createdAt: 'a', updatedAt: 'b', arquivos: [] }
    expect(normalizarProjeto(p, agora)).toEqual(p)
  })

  it('descarta campo estranho e corrige tipo errado', () => {
    const p = normalizarProjeto({ id: 'x', nome: 42, situacao: 'inventada', prazo: 'amanhã', lixo: { a: 1 } }, agora)
    expect(p).toEqual({
      id: 'x',
      nome: 'x',
      resultado: '',
      situacao: 'ativo',
      tipo: 'projeto',
      prazo: null,
      createdAt: agora.toISOString(),
      updatedAt: agora.toISOString(),
      arquivos: [],
    })
  })

  it('sem id não é projeto', () => {
    expect(normalizarProjeto({ nome: 'x' })).toBe(null)
    expect(normalizarProjetos([null, { id: 'a' }, 'x'], agora).map((p) => p.id)).toEqual(['a'])
    expect(normalizarProjetos(undefined)).toEqual([])
  })
})

describe('listarProjetos', () => {
  const registros = [
    { id: 'caso-maria', nome: 'Caso Maria', resultado: '', situacao: 'ativo', prazo: null, updatedAt: '2026-09-01T00:00:00.000Z' },
    { id: 'arquivo', nome: 'Arquivo', resultado: '', situacao: 'concluido', prazo: null, updatedAt: '2026-08-01T00:00:00.000Z' },
  ]

  it('junta fichas e etiquetas soltas, e acha a próxima ação', () => {
    const tasks = [
      { id: 't1', title: 'Ligar', projeto: 'caso-maria', tasklistId: PROXIMAS, status: 'needsAction', priority: 'alta', updated: '2026-09-20T00:00:00.000Z' },
      { id: 't2', title: 'Parecer', projeto: 'caso-maria', tasklistId: AGUARDANDO, status: 'needsAction' },
      { id: 't3', title: 'Solta', projeto: 'caso-joao', tasklistId: AGUARDANDO, status: 'needsAction' },
    ]
    const notes = [{ id: 'n1', projeto: 'caso-maria', updatedAt: '2026-09-25T00:00:00.000Z' }]
    const lista = listarProjetos({ registros, tasks, notes, idProximas: PROXIMAS }, agora)

    expect(lista).toHaveLength(3)
    // Concluído vai para o fim, independente do nome.
    expect(lista[2].id).toBe('arquivo')
    const maria = lista.find((p) => p.id === 'caso-maria')
    expect(maria).toMatchObject({ pendentes: 2, anotacoes: 1, semProximaAcao: false, implicito: false })
    expect(maria.proximaAcao.id).toBe('t1')
    expect(maria.ultimaAtividade).toBe('2026-09-25T00:00:00.000Z')

    const joao = lista.find((p) => p.id === 'caso-joao')
    expect(joao).toMatchObject({ implicito: true, semProximaAcao: true, situacao: 'ativo' })
  })

  it('projeto concluído ou pausado nunca é cobrado por falta de próxima ação', () => {
    const lista = listarProjetos({ registros, tasks: [], notes: [], idProximas: PROXIMAS }, agora)
    expect(lista.find((p) => p.id === 'arquivo').semProximaAcao).toBe(false)
  })

  it('conta as atrasadas', () => {
    const tasks = [
      { id: 't1', projeto: 'caso-maria', tasklistId: PROXIMAS, status: 'needsAction', due: '2026-09-10T00:00:00.000Z' },
    ]
    const lista = listarProjetos({ registros, tasks, notes: [], idProximas: PROXIMAS }, agora)
    expect(lista.find((p) => p.id === 'caso-maria').atrasadas).toBe(1)
  })
})

describe('tarefasDoProjeto', () => {
  it('separa por lista, com as concluídas mais recentes primeiro', () => {
    const tasks = [
      { id: 'a', projeto: 'p', tasklistId: PROXIMAS, status: 'needsAction' },
      { id: 'b', projeto: 'p', tasklistId: AGUARDANDO, status: 'needsAction' },
      { id: 'c', projeto: 'p', tasklistId: ALGUM_DIA, status: 'needsAction' },
      { id: 'd', projeto: 'p', tasklistId: ENTRADA, status: 'needsAction' },
      { id: 'e', projeto: 'p', tasklistId: 'antiga', status: 'needsAction' },
      { id: 'f', projeto: 'p', tasklistId: PROXIMAS, status: 'completed', completed: '2026-09-01T00:00:00.000Z' },
      { id: 'g', projeto: 'p', tasklistId: PROXIMAS, status: 'completed', completed: '2026-09-20T00:00:00.000Z' },
      { id: 'h', projeto: 'outro', tasklistId: PROXIMAS, status: 'needsAction' },
    ]
    const g = tarefasDoProjeto(tasks, 'p', { idProximas: PROXIMAS, idAguardando: AGUARDANDO, idAlgumDia: ALGUM_DIA, idEntrada: ENTRADA })
    expect(g.proximas.map((t) => t.id)).toEqual(['a'])
    expect(g.aguardando.map((t) => t.id)).toEqual(['b'])
    expect(g.algumDia.map((t) => t.id)).toEqual(['c'])
    expect(g.entrada.map((t) => t.id)).toEqual(['d'])
    expect(g.outras.map((t) => t.id)).toEqual(['e'])
    expect(g.concluidas.map((t) => t.id)).toEqual(['g', 'f'])
  })
})

describe('eventoDoProjeto', () => {
  it('reconhece pela marca privada gravada pelo app', () => {
    expect(eventoDoProjeto({ extendedProperties: { private: { [PROJETO_PROP]: 'caso-maria' } } }, 'caso-maria')).toBe(true)
  })

  it('reconhece pela etiqueta escrita no título ou na descrição', () => {
    expect(eventoDoProjeto({ summary: 'Visita #caso-maria' }, 'caso-maria')).toBe(true)
    expect(eventoDoProjeto({ summary: 'Visita', description: 'ver #Caso-Maria' }, 'caso-maria')).toBe(true)
  })

  it('não confunde com etiqueta mais longa nem com outro projeto', () => {
    expect(eventoDoProjeto({ summary: 'Visita #caso-maria-2' }, 'caso-maria')).toBe(false)
    expect(eventoDoProjeto({ summary: 'Visita #caso-joao' }, 'caso-maria')).toBe(false)
    expect(eventoDoProjeto({ summary: 'Visita' }, 'caso-maria')).toBe(false)
  })
})

describe('arquivos vinculados', () => {
  it('reconhece o tipo pelo link', () => {
    expect(tipoDeArquivo('https://docs.google.com/document/d/abc/edit').tipo).toBe('doc')
    expect(tipoDeArquivo('https://docs.google.com/spreadsheets/d/abc').tipo).toBe('planilha')
    expect(tipoDeArquivo('https://drive.google.com/drive/folders/abc').tipo).toBe('pasta')
    expect(tipoDeArquivo('https://drive.google.com/file/d/abc/view').tipo).toBe('drive')
    expect(tipoDeArquivo('https://site.gov.br/edital.pdf').tipo).toBe('pdf')
    expect(tipoDeArquivo('https://site.gov.br/pagina').tipo).toBe('link')
  })

  it('aceita link colado sem protocolo e recusa o que não é http(s)', () => {
    expect(normalizarLink('drive.google.com/file/d/abc')).toBe('https://drive.google.com/file/d/abc')
    expect(normalizarLink('javascript:alert(1)')).toBe(null)
    expect(normalizarLink('texto solto')).toBe(null)
    expect(normalizarLink('')).toBe(null)
  })

  it('sugere um nome quando a pessoa não escreve nenhum', () => {
    expect(nomeSugerido('https://site.gov.br/docs/edital%202026.pdf')).toBe('edital 2026.pdf')
    expect(nomeSugerido('https://docs.google.com/spreadsheets/d/abc')).toBe('Planilha')
    expect(nomeSugerido('https://www.exemplo.com.br/')).toBe('exemplo.com.br')
  })

  it('vincula, não duplica o mesmo link e recusa link inválido', () => {
    const agora = new Date('2026-09-29T12:00:00Z')
    const um = vincularArquivo([], { url: 'drive.google.com/file/d/abc', nome: ' Laudo ' }, agora)
    expect(um).toHaveLength(1)
    expect(um[0]).toMatchObject({ url: 'https://drive.google.com/file/d/abc', nome: 'Laudo', adicionadoEm: agora.toISOString() })
    expect(vincularArquivo(um, { url: 'https://drive.google.com/file/d/abc' }, agora)).toHaveLength(1)
    expect(vincularArquivo(um, { url: 'nada' }, agora)).toBe(null)
  })

  it('a ficha descarta arquivo com link inválido vindo do Drive', () => {
    const p = normalizarProjeto({ id: 'x', arquivos: [{ id: 'a', url: 'javascript:x' }, { id: 'b', url: 'https://a.com/x.pdf' }, 'lixo'] })
    expect(p.arquivos.map((a) => a.id)).toEqual(['b'])
    expect(p.arquivos[0].nome).toBe('x.pdf')
  })
})

describe('rotina', () => {
  it('rotina ativa sem próxima ação não é cobrada como parada', () => {
    const lista = listarProjetos({ registros: [{ id: 'reuniao', nome: 'Reunião', situacao: 'ativo', tipo: 'rotina' }], tasks: [], notes: [], idProximas: 'P' })
    expect(lista[0]).toMatchObject({ tipo: 'rotina', semProximaAcao: false })
  })

  it('fica fora da cobrança da revisão, junto com pausados e concluídos', () => {
    const lista = [
      { id: 'a', tipo: 'projeto', situacao: 'ativo' },
      { id: 'b', tipo: 'rotina', situacao: 'ativo' },
      { id: 'c', tipo: 'projeto', situacao: 'pausado' },
      { id: 'd', tipo: 'projeto', situacao: 'concluido' },
    ]
    expect(projetosForaDaCobranca(lista)).toEqual(['b', 'c', 'd'])
  })
})

describe('panoramaDosProjetos', () => {
  const agora = new Date(2026, 9, 6, 12)
  const lista = [
    { id: 'parado', nome: 'Parado', situacao: 'ativo', tipo: 'projeto', resultado: '', semProximaAcao: true, atrasadas: 0, diasSemAtividade: 30, proximaAcao: null },
    { id: 'andando', nome: 'Andando', situacao: 'ativo', tipo: 'projeto', resultado: 'Pronto', semProximaAcao: false, atrasadas: 1, diasSemAtividade: 20, proximaAcao: { title: 'x'.repeat(90) }, prazo: '2026-10-10' },
    { id: 'reuniao', nome: 'Reunião', situacao: 'ativo', tipo: 'rotina', resultado: '', semProximaAcao: false, atrasadas: 0, diasSemAtividade: 40, proximaAcao: null },
    { id: 'pausado', nome: 'Pausado', situacao: 'pausado', tipo: 'projeto', resultado: '', semProximaAcao: false, atrasadas: 2, diasSemAtividade: 90 },
  ]
  const tasks = [
    { id: 't1', projeto: 'reuniao', title: 'Levar pauta', status: 'needsAction', due: '2026-10-08T00:00:00.000Z' },
    { id: 't2', projeto: 'andando', title: 'Longe', status: 'needsAction', due: '2026-12-01T00:00:00.000Z' },
  ]
  const p = panoramaDosProjetos(lista, tasks, agora)
  const ids = (xs) => xs.map((x) => x.id)

  it('parados, sem resultado e esquecidos só olham projetos ativos (não rotinas)', () => {
    expect(ids(p.parados)).toEqual(['parado'])
    expect(ids(p.semResultado)).toEqual(['parado'])
    expect(ids(p.esquecidos)).toEqual(['andando'])
  })

  it('atrasados e prazos incluem rotina ativa, nunca o pausado', () => {
    expect(ids(p.atrasados)).toEqual(['andando'])
    expect(p.prazos.map((x) => x.titulo)).toEqual(['Levar pauta', 'Prazo do projeto'])
  })

  it('aponta a próxima ação que parece uma ideia inteira', () => {
    expect(ids(p.acaoVaga)).toEqual(['andando'])
    expect(pareceIdeia('Ligar para o cartório')).toBe(false)
  })
})

describe('marcos', () => {
  const base = [
    { id: 'a', titulo: 'Sem data', data: null, feito: false },
    { id: 'b', titulo: 'Relatório', data: '2026-11-30', feito: false },
    { id: 'c', titulo: 'Já feito', data: '2026-09-01', feito: true },
    { id: 'd', titulo: 'Reunião', data: '2026-10-01', feito: false },
  ]

  it('ordena pendentes por data, sem data no fim e feitos por último; descarta lixo', () => {
    expect(normalizarMarcos([...base, null, { id: 'x', titulo: '  ' }, { titulo: 'sem id' }]).map((m) => m.id)).toEqual(['d', 'b', 'a', 'c'])
    expect(normalizarMarcos([{ id: 'z', titulo: 'X', data: 'amanhã', feito: 'sim' }])).toEqual([{ id: 'z', titulo: 'X', data: null, feito: false }])
  })

  it('fica de fora da ficha quando não há nenhum', () => {
    expect(normalizarProjeto({ id: 'p' }, agora).marcos).toBeUndefined()
    expect(normalizarProjeto({ id: 'p', marcos: base }, agora).marcos).toHaveLength(4)
  })

  it('adiciona, alterna e remove', () => {
    const com = adicionarMarco(base, { titulo: '  Novo ', data: '2026-10-15' }, agora)
    expect(com.map((m) => m.titulo)).toContain('Novo')
    expect(adicionarMarco(base, { titulo: '   ' })).toHaveLength(4)
    expect(alternarMarco(base, 'c').find((m) => m.id === 'c').feito).toBe(false)
    expect(removerMarco(base, 'a').map((m) => m.id)).toEqual(['d', 'b', 'c'])
  })

  it('aponta o próximo marco e se ele já venceu', () => {
    expect(proximoMarco(base, '2026-10-06')).toMatchObject({ id: 'd', atrasado: true })
    expect(proximoMarco(base, '2026-09-20')).toMatchObject({ id: 'd', atrasado: false })
    expect(proximoMarco([base[2]], '2026-10-06')).toBeNull()
  })
})

describe('página do projeto', () => {
  const inicio = (e) => new Date(e.start.dateTime)

  it('junta concluídas e compromissos passados, do mais recente ao mais antigo', () => {
    const h = historicoDoProjeto(
      {
        concluidas: [
          { id: 'a', title: 'Ofício enviado', status: 'completed', completed: '2026-10-05T12:00:00Z' },
          { id: 'b', title: 'Sem data', status: 'completed' },
        ],
        eventosPassados: [{ id: 'e', calendarId: 'c', summary: 'Reunião', start: { dateTime: '2026-10-06T13:00:00Z' } }],
      },
      inicio
    )
    expect(h.map((x) => [x.tipo, x.titulo])).toEqual([
      ['compromisso', 'Reunião'],
      ['tarefa', 'Ofício enviado'],
    ])
  })

  it('não repete concluída que veio pelas duas buscas, e ignora pendente', () => {
    const t = { id: 'x', status: 'completed' }
    expect(juntarConcluidas([t, { id: 'p', status: 'needsAction' }], [{ ...t }]).map((x) => x.id)).toEqual(['x'])
  })

  it('resume a anotação numa linha, cortando na palavra', () => {
    expect(trechoDaAnotacao('Visita   feita.\n\nFamília pediu  retorno.')).toBe('Visita feita. Família pediu retorno.')
    expect(trechoDaAnotacao('palavra '.repeat(50), 20)).toBe('palavra palavra…')
    expect(trechoDaAnotacao(undefined)).toBe('')
  })
})
