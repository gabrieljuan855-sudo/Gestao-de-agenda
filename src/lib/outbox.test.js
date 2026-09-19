import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enfileirar, pendentes, quantasPendentes, descarregar } from './outbox.js'

// A fila mora no localStorage; o ambiente de teste do vitest não tem um.
beforeEach(() => {
  const dados = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => dados.set(k, String(v)),
    removeItem: (k) => dados.delete(k),
  })
})

describe('enfileirar', () => {
  it('guarda o texto na ordem em que foi capturado', () => {
    enfileirar('ligar para a Ana')
    enfileirar('levar o documento do caso Silva')
    expect(pendentes().map((i) => i.texto)).toEqual(['ligar para a Ana', 'levar o documento do caso Silva'])
  })

  it('dá um id próprio a cada item', () => {
    const a = enfileirar('x')
    const b = enfileirar('x')
    expect(a.id).not.toBe(b.id)
  })
})

describe('descarregar', () => {
  it('envia tudo e esvazia a fila quando a rede responde', async () => {
    enfileirar('primeira')
    enfileirar('segunda')
    const enviados = []

    const r = await descarregar(async (texto) => enviados.push(texto))

    expect(enviados).toEqual(['primeira', 'segunda'])
    expect(r).toEqual({ enviados: 2, restantes: 0 })
  })

  it('para no primeiro erro e mantém o que não foi gravado', async () => {
    // O caso real: a rede caiu no meio. Insistir com os outros repetiria a
    // mesma falha, e o que não subiu não pode sumir da fila.
    enfileirar('primeira')
    enfileirar('segunda')
    enfileirar('terceira')

    const r = await descarregar(async (texto) => {
      if (texto === 'segunda') throw new Error('sem rede')
    })

    expect(r.enviados).toBe(1)
    expect(pendentes().map((i) => i.texto)).toEqual(['segunda', 'terceira'])
  })

  it('não manda duas vezes o que já subiu', async () => {
    enfileirar('única')
    await descarregar(async () => {})

    const segundaVolta = []
    await descarregar(async (texto) => segundaVolta.push(texto))

    expect(segundaVolta).toEqual([])
  })

  it('não quebra com a fila vazia', async () => {
    expect(await descarregar(async () => {})).toEqual({ enviados: 0, restantes: 0 })
  })

  it('sobrevive a uma recarga da página: o que ficou na fila continua lá', async () => {
    enfileirar('não consegui gravar')
    await descarregar(async () => {
      throw new Error('sem rede')
    })
    // Uma recarga só reconstrói o módulo; quem guarda é o localStorage.
    expect(quantasPendentes()).toBe(1)
  })
})
