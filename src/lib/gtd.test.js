import { describe, expect, it } from 'vitest'
import { acharLista, temEntrada, LISTA_ENTRADA } from './gtd.js'

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
