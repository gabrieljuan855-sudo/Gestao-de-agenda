import { describe, expect, it } from 'vitest'
import {
  novaPeca,
  editarPeca,
  classificarPeca,
  normalizarPeca,
  normalizarLook,
  diasParada,
  textoDoUso,
  ordenarPecas,
  filtrarPecas,
  salvarLook,
  registrarFeedback,
  historicoDeLooks,
  mesclarGuardaRoupa,
  difere,
  dataLocalDe,
} from './guardaRoupa.js'

const agora = new Date('2026-11-16T12:00:00Z')
const foto = { driveId: 'f1', url: 'https://drive.google.com/file/d/f1' }
const peca = (extra = {}) => ({ ...novaPeca({ foto }, agora), ...extra })

describe('peça', () => {
  it('entra pendente quando nada foi preenchido, e classificada com categoria e uso', () => {
    expect(novaPeca({ foto }, agora)).toMatchObject({ status: 'pendente', ativa: true, usos: 0, ultimoUso: null, categoria: '' })
    expect(novaPeca({ foto, categoria: 'calcado', ocasioes: ['casual'] }, agora).status).toBe('classificada')
    expect(novaPeca({ foto, categoria: 'calcado' }, agora).status).toBe('pendente')
  })

  it('sem foto não é peça', () => {
    expect(novaPeca({ foto: null }, agora)).toBeNull()
    expect(normalizarPeca({ id: 'x' })).toBeNull()
  })

  it('valor fora da lista cai, e ocasião aceita um valor solto', () => {
    const p = normalizarPeca({ id: 'a', foto, categoria: 'chapéu', ocasioes: 'casual', temperaturas: ['frio', 'gelado'], usos: -3, ultimoUso: 'ontem' })
    expect(p).toMatchObject({ categoria: '', ocasioes: ['casual'], temperaturas: ['frio'], usos: 0, ultimoUso: null })
  })

  it('editar não devolve para pendente uma peça já classificada', () => {
    const classificada = classificarPeca(peca(), { nome: 'Camisa' }, agora.toISOString())
    expect(classificada.status).toBe('classificada')
    expect(editarPeca(classificada, { categoria: '' }, agora).status).toBe('classificada')
  })

  it('classificar muda só os campos informados', () => {
    const p = peca({ nome: 'Tênis', cor: 'branco' })
    expect(classificarPeca(p, { categoria: 'calcado', cor: undefined }, agora.toISOString())).toMatchObject({ nome: 'Tênis', cor: 'branco', categoria: 'calcado' })
  })
})

describe('tempo parada', () => {
  it('conta do último uso, ou do cadastro para a nunca usada', () => {
    expect(diasParada(peca({ ultimoUso: '2026-11-10' }), '2026-11-16')).toBe(6)
    expect(diasParada(peca({ cadastradaEm: '2026-11-01T15:00:00Z' }), '2026-11-16')).toBe(15)
    expect(textoDoUso(peca({ ultimoUso: '2026-11-15' }), '2026-11-16')).toBe('Parada há 1 dia')
    expect(textoDoUso(peca({ cadastradaEm: '2026-11-01T15:00:00Z' }), '2026-11-16')).toBe('Nunca usada · cadastrada há 15 dias')
  })

  it('o dia é o de Brasília, não o UTC', () => {
    expect(dataLocalDe('2026-11-16T01:30:00Z')).toBe('2026-11-15')
  })

  it('ordena pelas paradas há mais tempo e filtra por categoria, sem as desativadas', () => {
    const a = peca({ id: 'a', ultimoUso: '2026-11-15', categoria: 'calcado' })
    const b = peca({ id: 'b', ultimoUso: '2026-10-01', categoria: 'calcado', ativa: false })
    const c = peca({ id: 'c', ultimoUso: '2026-11-01' })
    expect(ordenarPecas([a, b, c], 'paradas', '2026-11-16').map((p) => p.id)).toEqual(['b', 'c', 'a'])
    expect(filtrarPecas([a, b, c], { categoria: 'calcado' }).map((p) => p.id)).toEqual(['a'])
    expect(filtrarPecas([a, b, c], { inativas: true }).length).toBe(3)
  })
})

describe('look do dia', () => {
  const base = () => ({ pecas: [peca({ id: 'a' }), peca({ id: 'b' }), peca({ id: 'c' })], looks: [] })
  const comLook = (data = '2026-11-16', ids = ['a', 'b']) => {
    const { pecas, looks } = salvarLook(base(), { data, pecas: ids, texto: 'Dia fresco', clima: '18–24 °C' }, agora)
    return { pecas, looks }
  }

  it('salvar substitui o look da mesma data', () => {
    const um = comLook()
    const dois = salvarLook(um, { data: '2026-11-16', pecas: ['c'], texto: 'Outro' }, agora)
    expect(dois.looks).toHaveLength(1)
    expect(dois.looks[0]).toMatchObject({ pecas: ['c'], texto: 'Outro', feedback: '' })
  })

  it('"usei" grava a data e soma um uso em cada peça do look, uma vez só', () => {
    const r = registrarFeedback(comLook(), { data: '2026-11-16', feedback: 'usei' }, agora)
    expect(r.pecas.map((p) => [p.id, p.usos, p.ultimoUso])).toEqual([['a', 1, '2026-11-16'], ['b', 1, '2026-11-16'], ['c', 0, null]])
    const deNovo = registrarFeedback(r, { data: '2026-11-16', feedback: 'usei' }, agora)
    expect(deNovo.pecas.find((p) => p.id === 'a').usos).toBe(1)
  })

  it('"não gostei" guarda o motivo e não conta uso', () => {
    const r = registrarFeedback(comLook(), { data: '2026-11-16', feedback: 'nao_gostei', motivo: 'muito quente' }, agora)
    expect(r.look).toMatchObject({ feedback: 'nao_gostei', motivo: 'muito quente' })
    expect(r.pecas.every((p) => p.usos === 0)).toBe(true)
  })

  it('trocar "usei" por "não gostei" devolve o uso e o último uso volta ao look anterior', () => {
    let estado = comLook('2026-11-10', ['a'])
    estado = registrarFeedback(estado, { data: '2026-11-10', feedback: 'usei' }, agora)
    estado = salvarLook(estado, { data: '2026-11-16', pecas: ['a', 'b'], texto: 'x' }, agora)
    estado = registrarFeedback(estado, { data: '2026-11-16', feedback: 'usei' }, agora)
    expect(estado.pecas.find((p) => p.id === 'a')).toMatchObject({ usos: 2, ultimoUso: '2026-11-16' })
    estado = registrarFeedback(estado, { data: '2026-11-16', feedback: 'nao_gostei' }, agora)
    expect(estado.pecas.find((p) => p.id === 'a')).toMatchObject({ usos: 1, ultimoUso: '2026-11-10' })
    expect(estado.pecas.find((p) => p.id === 'b')).toMatchObject({ usos: 0, ultimoUso: null })
  })

  it('substituir um look já usado desfaz o uso dele', () => {
    let estado = registrarFeedback(comLook(), { data: '2026-11-16', feedback: 'usei' }, agora)
    estado = salvarLook(estado, { data: '2026-11-16', pecas: ['c'], texto: 'novo' }, agora)
    expect(estado.pecas.map((p) => p.usos)).toEqual([0, 0, 0])
  })

  it('"usei" num look antigo não recua o último uso mais recente', () => {
    let estado = comLook('2026-11-10', ['a'])
    estado = { ...estado, pecas: estado.pecas.map((p) => (p.id === 'a' ? { ...p, ultimoUso: '2026-11-14', usos: 1 } : p)) }
    estado = registrarFeedback(estado, { data: '2026-11-10', feedback: 'usei' }, agora)
    expect(estado.pecas.find((p) => p.id === 'a')).toMatchObject({ usos: 2, ultimoUso: '2026-11-14' })
  })

  it('com o relógio do aparelho atrás de quem gravou, a resposta ainda sai mais nova', () => {
    const doConector = salvarLook(base(), { data: '2026-11-16', pecas: ['a'], texto: 'x' }, new Date('2026-11-16T14:00:00Z'))
    const atrasado = new Date('2026-11-16T09:00:00Z')
    const r = registrarFeedback(doConector, { data: '2026-11-16', feedback: 'usei' }, atrasado)
    const mesclado = mesclarGuardaRoupa(r, doConector, atrasado.getTime())
    expect(mesclado.looks[0].feedback).toBe('usei')
    expect(mesclado.pecas.find((p) => p.id === 'a').usos).toBe(1)
  })

  it('feedback em data sem look não faz nada', () => {
    expect(registrarFeedback(base(), { data: '2026-11-16', feedback: 'usei' }, agora)).toBeNull()
  })

  it('histórico traz só os últimos N dias, do mais novo para o mais velho', () => {
    const looks = ['2026-11-16', '2026-11-01', '2026-11-12', '2026-11-20'].map((data) => normalizarLook({ data, pecas: ['a'] }, agora))
    expect(historicoDeLooks(looks, '2026-11-16', 7).map((l) => l.data)).toEqual(['2026-11-16', '2026-11-12'])
  })
})

describe('mesclagem com o Drive', () => {
  it('fica com a peça de cada lado e com a versão mais nova da mesma', () => {
    const velha = peca({ id: 'a', nome: 'velha', updatedAt: '2026-11-10T00:00:00.000Z' })
    const nova = { ...velha, nome: 'nova', updatedAt: '2026-11-12T00:00:00.000Z' }
    const so = peca({ id: 'b' })
    const r = mesclarGuardaRoupa({ pecas: [velha, so], looks: [], deleted: [] }, { pecas: [nova], looks: [], deleted: [] }, agora.getTime())
    expect(r.pecas.find((p) => p.id === 'a').nome).toBe('nova')
    expect(r.pecas.map((p) => p.id).sort()).toEqual(['a', 'b'])
  })

  it('peça excluída de um lado não volta pelo outro', () => {
    const p = peca({ id: 'a', updatedAt: '2026-11-10T00:00:00.000Z' })
    const rastro = [{ id: 'a', at: '2026-11-15T00:00:00.000Z' }]
    expect(mesclarGuardaRoupa({ pecas: [], looks: [], deleted: rastro }, { pecas: [p], looks: [], deleted: [] }, agora.getTime()).pecas).toEqual([])
    expect(mesclarGuardaRoupa({ pecas: [p], looks: [], deleted: [] }, { pecas: [], looks: [], deleted: rastro }, agora.getTime()).pecas).toEqual([])
  })

  it('o look mais novo da mesma data vence, e difere percebe a mudança', () => {
    const a = normalizarLook({ data: '2026-11-16', pecas: ['a'], updatedAt: '2026-11-16T08:00:00.000Z' }, agora)
    const b = { ...a, feedback: 'usei', updatedAt: '2026-11-16T09:00:00.000Z' }
    const r = mesclarGuardaRoupa({ pecas: [], looks: [a], deleted: [] }, { pecas: [], looks: [b], deleted: [] }, agora.getTime())
    expect(r.looks).toEqual([b])
    expect(difere(r, { pecas: [], looks: [a], deleted: [] })).toBe(true)
    expect(difere(r, { pecas: [], looks: [b], deleted: [] })).toBe(false)
  })
})
