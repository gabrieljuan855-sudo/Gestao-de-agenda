import { describe, expect, it, vi } from 'vitest'
import { criarMemoriaDeRespostas } from './memoriaDeRespostas.js'

describe('criarMemoriaDeRespostas', () => {
  it('reaproveita a resposta de um pedido idêntico dentro do prazo', async () => {
    let agora = 0
    const lembrar = criarMemoriaDeRespostas({ ttlMs: 1000, agora: () => agora })
    const buscar = vi.fn().mockResolvedValue({ texto: 'oi' })
    await lembrar('a', buscar)
    agora = 999
    expect(await lembrar('a', buscar)).toEqual({ texto: 'oi' })
    expect(buscar).toHaveBeenCalledTimes(1)
  })

  it('chama de novo depois que o prazo passa', async () => {
    let agora = 0
    const lembrar = criarMemoriaDeRespostas({ ttlMs: 1000, agora: () => agora })
    const buscar = vi.fn().mockResolvedValue({ n: 1 })
    await lembrar('a', buscar)
    agora = 1000
    await lembrar('a', buscar)
    expect(buscar).toHaveBeenCalledTimes(2)
  })

  it('pedidos diferentes não se misturam', async () => {
    const lembrar = criarMemoriaDeRespostas({ ttlMs: 1000 })
    const buscar = vi.fn().mockImplementation(async () => ({}))
    await lembrar('a', buscar)
    await lembrar('b', buscar)
    expect(buscar).toHaveBeenCalledTimes(2)
  })

  it('dois pedidos idênticos ao mesmo tempo viram uma chamada só', async () => {
    const lembrar = criarMemoriaDeRespostas({ ttlMs: 1000 })
    const buscar = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(() => r({ ok: true }), 5)))
    const [x, y] = await Promise.all([lembrar('a', buscar), lembrar('a', buscar)])
    expect(buscar).toHaveBeenCalledTimes(1)
    expect(x).toEqual(y)
  })

  it('não lembra erro: tentar de novo vai ao servidor', async () => {
    const lembrar = criarMemoriaDeRespostas({ ttlMs: 1000 })
    const buscar = vi.fn().mockRejectedValueOnce(new Error('falhou')).mockResolvedValueOnce({ ok: true })
    await expect(lembrar('a', buscar)).rejects.toThrow('falhou')
    expect(await lembrar('a', buscar)).toEqual({ ok: true })
    expect(buscar).toHaveBeenCalledTimes(2)
  })

  it('entrega cópias: quem recebe pode mexer sem estragar a memória', async () => {
    const lembrar = criarMemoriaDeRespostas({ ttlMs: 1000 })
    const buscar = vi.fn().mockResolvedValue({ itens: [1] })
    const primeira = await lembrar('a', buscar)
    primeira.itens.push(2)
    expect((await lembrar('a', buscar)).itens).toEqual([1])
  })

  it('respeita o teto de pedidos guardados', async () => {
    const lembrar = criarMemoriaDeRespostas({ ttlMs: 1000, maximo: 2 })
    const buscar = vi.fn().mockResolvedValue({})
    await lembrar('a', buscar)
    await lembrar('b', buscar)
    await lembrar('c', buscar) // expulsa 'a'
    await lembrar('a', buscar)
    expect(buscar).toHaveBeenCalledTimes(4)
  })
})
