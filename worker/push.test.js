import { describe, expect, it } from 'vitest'
import { cifrarConteudo, gerarChavesVapid, cabecalhoVapid, paraBase64Url, deBase64Url } from './push.js'

const enc = new TextEncoder()

async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8))
}

// O lado do aparelho (o que o iPhone faz ao receber), escrito à parte a
// partir da RFC 8291 — se o servidor cifrar errado, isto não decifra.
async function aparelho() {
  const par = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const publica = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))
  const inscricao = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: paraBase64Url(publica), auth: paraBase64Url(auth) } }

  async function decifrar(corpo) {
    const sal = corpo.slice(0, 16)
    const idlen = corpo[20]
    const asPublica = corpo.slice(21, 21 + idlen)
    const cifrado = corpo.slice(21 + idlen)
    const chaveAs = await crypto.subtle.importKey('raw', asPublica, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const compartilhado = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: chaveAs }, par.privateKey, 256))
    const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...publica, ...asPublica])
    const ikm = await hkdf(auth, compartilhado, info, 32)
    const cek = await hkdf(sal, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
    const nonce = await hkdf(sal, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
    const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
    const claro = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, cifrado))
    expect(claro[claro.length - 1]).toBe(2)
    return new TextDecoder().decode(claro.slice(0, -1))
  }
  return { inscricao, decifrar }
}

describe('Web Push', () => {
  it('o aparelho decifra o que o servidor cifrou', async () => {
    const { inscricao, decifrar } = await aparelho()
    const conteudo = JSON.stringify({ titulo: 'Reunião AEPETI', corpo: 'Em 10 min · 14:00–15:00\nCREAS' })
    const corpo = await cifrarConteudo(inscricao, conteudo)
    expect([...corpo.slice(16, 20)]).toEqual([0, 0, 0x10, 0])
    expect(await decifrar(corpo)).toBe(conteudo)
  })

  it('assina o VAPID com a chave do servidor, para o serviço certo', async () => {
    const chaves = await gerarChavesVapid()
    const cab = await cabecalhoVapid('https://web.push.apple.com/abc', chaves, 'mailto:a@b.com', 1_000_000_000)
    const [, jwt, k] = cab.match(/^vapid t=([^,]+), k=(.+)$/)
    expect(k).toBe(chaves.publica)
    const [h, p, s] = jwt.split('.')
    const corpo = JSON.parse(new TextDecoder().decode(deBase64Url(p)))
    expect(corpo).toMatchObject({ aud: 'https://web.push.apple.com', sub: 'mailto:a@b.com', exp: 1_000_000 + 12 * 3600 })
    const pub = await crypto.subtle.importKey('raw', deBase64Url(chaves.publica), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, deBase64Url(s), enc.encode(`${h}.${p}`))
    expect(ok).toBe(true)
  })
})
