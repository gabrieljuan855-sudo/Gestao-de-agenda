import { describe, expect, it } from 'vitest'
import { montarContextoDoProjeto, descreverEnvio } from './aiProjeto.js'

describe('montarContextoDoProjeto', () => {
  it('manda só ficha, títulos com a lista de cada tarefa e trechos das anotações', () => {
    const ctx = montarContextoDoProjeto({
      projeto: { id: 'app', nome: 'App', tipo: 'projeto', resultado: '', prazo: null, arquivos: [{ url: 'x' }] },
      grupos: {
        proximas: [{ id: 't1', title: 'Ligar', due: '2026-10-10T00:00:00.000Z', notes: 'segredo' }],
        aguardando: [{ id: 't2', title: 'Parecer' }],
      },
      anotacoes: [{ id: 'n1', title: 'Reunião', body: 'a'.repeat(3000) }],
      contextos: ['telefone'],
    })
    expect(ctx.projeto).toEqual({ nome: 'App', tipo: 'projeto', resultado: '', prazo: null })
    expect(ctx.tarefas).toEqual([
      { titulo: 'Ligar', lista: 'proximas', prazo: '2026-10-10' },
      { titulo: 'Parecer', lista: 'aguardando', prazo: null },
    ])
    expect(ctx.anotacoes[0].trecho).toHaveLength(1200)
    expect(JSON.stringify(ctx)).not.toContain('segredo')
    expect(ctx.alvo).toBe(null)
  })

  it('descreve o que vai ser enviado', () => {
    expect(descreverEnvio({ tarefas: [1, 2], anotacoes: [1] })).toBe('Vai para a IA: a ficha, 2 tarefas e trechos de 1 anotação deste projeto.')
    expect(descreverEnvio({ tarefas: [], anotacoes: [] })).toBe('Vai para a IA: a ficha deste projeto.')
  })
})
