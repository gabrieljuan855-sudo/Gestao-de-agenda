import { describe, expect, it } from 'vitest'
import { normalizarAvisos, avisosVencidos, proximoAlarme, podarEnviados, inscricaoValida } from './avisos.js'

const agora = 1_800_000_000_000
const min = 60 * 1000

describe('agenda de avisos do servidor', () => {
  const lista = normalizarAvisos(
    [
      { id: 'b', quando: agora + 30 * min, titulo: 'Depois' },
      { id: 'a', quando: agora + 5 * 1000, titulo: 'Agora' },
      { id: 'velho', quando: agora - 60 * min, titulo: 'Passou' },
      { id: '', quando: agora },
      { id: 'x', quando: 'amanhã' },
    ],
    agora
  )

  it('ordena, descarta inválido e o que já passou há muito', () => {
    expect(lista.map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('separa o que vence agora do próximo alarme', () => {
    expect(avisosVencidos(lista, {}, agora).map((a) => a.id)).toEqual(['a'])
    expect(proximoAlarme(lista, {}, agora)).toBe(agora + 30 * min)
  })

  it('não repete aviso já enviado', () => {
    expect(avisosVencidos(lista, { a: agora }, agora)).toEqual([])
    expect(proximoAlarme(lista, { b: 1 }, agora + 31 * min)).toBeNull()
  })

  it('esquece enviados com mais de um dia', () => {
    expect(podarEnviados({ a: agora - 2 * 24 * 60 * min, b: agora }, agora)).toEqual({ b: agora })
  })

  it('só aceita inscrição https com as chaves', () => {
    expect(inscricaoValida({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'a', auth: 'b' } })).toBe(true)
    expect(inscricaoValida({ endpoint: 'http://x', keys: { p256dh: 'a', auth: 'b' } })).toBe(false)
    expect(inscricaoValida({ endpoint: 'https://x' })).toBe(false)
  })
})

describe('Durable Object dos avisos, do começo ao fim', () => {
  it('guarda a lista, dispara no alarme e não repete', async () => {
    const { AvisosDoUsuario } = await import('./avisos.js')
    const { gerarChavesVapid, paraBase64Url } = await import('./push.js')

    const dados = new Map()
    let alarme = null
    const ctx = {
      storage: {
        get: async (k) => dados.get(k),
        put: async (k, v) => dados.set(k, structuredClone(v)),
        setAlarm: async (t) => (alarme = t),
        deleteAlarm: async () => (alarme = null),
      },
    }
    const obj = new AvisosDoUsuario(ctx, {})

    const par = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const publica = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey))
    const inscricao = {
      endpoint: 'https://web.push.apple.com/aparelho',
      keys: { p256dh: paraBase64Url(publica), auth: paraBase64Url(crypto.getRandomValues(new Uint8Array(16))) },
    }
    const agora = Date.now()
    const pedido = (corpo) => new Request('https://avisos/', { method: 'POST', body: JSON.stringify(corpo) })
    const r = await obj.fetch(
      pedido({
        op: 'atualizar',
        inscricao,
        chaves: await gerarChavesVapid(),
        contato: 'mailto:a@b.com',
        avisos: [
          { id: 'logo', quando: agora + 2000, titulo: 'Reunião AEPETI', corpo: 'Em 10 min', tag: 'compromisso-1' },
          { id: 'depois', quando: agora + 3600_000, titulo: 'Outra' },
        ],
      })
    )
    expect(await r.json()).toMatchObject({ ok: true, avisos: 2, aparelhos: 1 })
    expect(alarme).toBeLessThanOrEqual(Date.now())

    const enviados = []
    const original = globalThis.fetch
    globalThis.fetch = async (url, opcoes) => {
      enviados.push({ url, headers: opcoes.headers, bytes: opcoes.body.length })
      return new Response(null, { status: 201 })
    }
    try {
      await obj.alarm()
      await obj.alarm() // disparo repetido não manda de novo
    } finally {
      globalThis.fetch = original
    }
    expect(enviados).toHaveLength(1)
    expect(enviados[0].url).toBe(inscricao.endpoint)
    expect(enviados[0].headers['Content-Encoding']).toBe('aes128gcm')
    expect(enviados[0].headers.Authorization).toMatch(/^vapid t=.+, k=.+$/)
    expect(alarme).toBe(agora + 3600_000)
  })

  it('esquece o aparelho quando o serviço diz que a inscrição morreu', async () => {
    const { AvisosDoUsuario } = await import('./avisos.js')
    const { gerarChavesVapid, paraBase64Url } = await import('./push.js')
    const dados = new Map()
    const ctx = { storage: { get: async (k) => dados.get(k), put: async (k, v) => dados.set(k, v), setAlarm: async () => {}, deleteAlarm: async () => {} } }
    const obj = new AvisosDoUsuario(ctx, {})
    const par = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const p256dh = paraBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey)))
    const inscricao = { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh, auth: paraBase64Url(new Uint8Array(16)) } }
    await obj.fetch(new Request('https://avisos/', { method: 'POST', body: JSON.stringify({ op: 'atualizar', inscricao, chaves: await gerarChavesVapid(), avisos: [{ id: 'a', quando: Date.now(), titulo: 'X' }] }) }))
    const original = globalThis.fetch
    globalThis.fetch = async () => new Response(null, { status: 410 })
    try {
      await obj.alarm()
    } finally {
      globalThis.fetch = original
    }
    expect(dados.get('inscricoes')).toEqual({})
  })
})
