import { describe, expect, it } from 'vitest'
import { acharLista, temEntrada, parseMeta, encodeMeta, etiqueta, LISTA_ENTRADA } from './gtd.js'

const listas = [
  { id: '1', title: 'Prioridade Máxima (menos de uma semana)' },
  { id: '2', title: 'Entrada' },
  { id: '3', title: 'Prioridade Baixa' },
]

describe('acharLista', () => {
  it('acha pelo nome exato', () => {
    expect(acharLista(listas, LISTA_ENTRADA)?.id).toBe('2')
  })

  it('ignora acento e caixa', () => {
    // O caso que importa: a lista pode ter sido criada à mão no app do
    // Google. Não reconhecer por causa de um acento criaria uma segunda
    // Entrada, que é o pior resultado possível.
    expect(acharLista([{ id: '9', title: 'entrada' }], 'Entrada')?.id).toBe('9')
    expect(acharLista([{ id: '9', title: 'ENTRADA' }], 'Entrada')?.id).toBe('9')
    expect(acharLista([{ id: '9', title: 'Próximas ações' }], 'Proximas acoes')?.id).toBe('9')
  })

  it('ignora espaço sobrando nas pontas', () => {
    expect(acharLista([{ id: '9', title: ' Entrada ' }], 'Entrada')?.id).toBe('9')
  })

  it('devolve null quando não existe, e não quebra com lista vazia ou ausente', () => {
    expect(acharLista(listas, 'Aguardando')).toBe(null)
    expect(acharLista([], 'Entrada')).toBe(null)
    expect(acharLista(undefined, 'Entrada')).toBe(null)
    expect(acharLista([{ id: '9' }], 'Entrada')).toBe(null)
  })

  it('não confunde com um nome que apenas contém o procurado', () => {
    expect(acharLista([{ id: '9', title: 'Entrada de documentos' }], 'Entrada')).toBe(null)
  })
})

describe('temEntrada', () => {
  it('diz se a Entrada já existe na conta', () => {
    expect(temEntrada(listas)).toBe(true)
    expect(temEntrada([{ id: '1', title: 'Prioridade Baixa' }])).toBe(false)
  })
})

describe('etiqueta', () => {
  it('tira acento, caixa e espaço', () => {
    // Espaço quebraria o bloco (é o separador) e acento criaria dois
    // contextos para a mesma coisa.
    expect(etiqueta('Ana Paula')).toBe('ana-paula')
    expect(etiqueta('Ligação')).toBe('ligacao')
    expect(etiqueta('  no  computador  ')).toBe('no-computador')
  })

  it('não deixa sobrar traço nas pontas', () => {
    expect(etiqueta('!importante!')).toBe('importante')
    expect(etiqueta('')).toBe('')
  })
})

describe('parseMeta', () => {
  it('lê a nota antiga, que só tinha prioridade', () => {
    // As tarefas que já existem na conta estão gravadas assim — quebrar isso
    // apagaria a prioridade de tudo que foi criado antes.
    expect(parseMeta('[alta] ligar para a escola')).toEqual({
      priority: 'alta',
      contexto: null,
      aguardando: null,
      notes: 'ligar para a escola',
    })
  })

  it('lê contexto e de quem se está esperando', () => {
    expect(parseMeta('[media @ligar ~ana desde:2026-09-10] retorno do laudo')).toEqual({
      priority: 'media',
      contexto: 'ligar',
      aguardando: { quem: 'ana', desde: '2026-09-10' },
      notes: 'retorno do laudo',
    })
  })

  it('aceita espera sem data', () => {
    expect(parseMeta('[baixa ~joao] x').aguardando).toEqual({ quem: 'joao', desde: null })
  })

  it('devolve a nota inteira quando não há bloco de etiquetas', () => {
    expect(parseMeta('só um texto solto')).toEqual({
      priority: null,
      contexto: null,
      aguardando: null,
      notes: 'só um texto solto',
    })
  })

  it('traduz as prioridades antigas', () => {
    expect(parseMeta('[urgente] x').priority).toBe('alta')
    expect(parseMeta('[pode_esperar] x').priority).toBe('baixa')
  })

  it('não quebra com nota vazia, bloco vazio ou etiqueta desconhecida', () => {
    expect(parseMeta('')).toEqual({ priority: null, contexto: null, aguardando: null, notes: '' })
    expect(parseMeta(null).notes).toBe('')
    expect(parseMeta('[] x').notes).toBe('x')
    expect(parseMeta('[xpto @ligar] x')).toMatchObject({ priority: null, contexto: 'ligar' })
  })
})

describe('encodeMeta', () => {
  it('escreve o bloco numa linha legível', () => {
    expect(encodeMeta({ priority: 'alta', contexto: 'ligar' }, 'falar sobre a vaga')).toBe(
      '[alta @ligar] falar sobre a vaga'
    )
  })

  it('guarda a espera com quem e desde quando', () => {
    const notes = encodeMeta(
      { priority: 'media', aguardando: { quem: 'Ana Paula', desde: '2026-09-10' } },
      'laudo do caso'
    )
    expect(notes).toBe('[media ~ana-paula desde:2026-09-10] laudo do caso')
  })

  it('aplica a prioridade padrão quando não vem nenhuma', () => {
    expect(encodeMeta({}, 'x')).toBe('[media] x')
    expect(encodeMeta(undefined, 'x')).toBe('[media] x')
  })

  it('sobrevive à ida e volta', () => {
    const original = {
      priority: 'baixa',
      contexto: 'computador',
      aguardando: { quem: 'joao', desde: '2026-01-05' },
    }
    const lido = parseMeta(encodeMeta(original, 'texto livre'))
    expect(lido).toEqual({ ...original, notes: 'texto livre' })
  })

  it('não deixa a nota vazia virar espaço sobrando', () => {
    expect(encodeMeta({ priority: 'alta' }, '')).toBe('[alta]')
  })
})
