// Web Push sem biblioteca: a cifra do conteúdo (RFC 8291, aes128gcm) e a
// assinatura do servidor (VAPID, RFC 8292), com a WebCrypto que o Worker já
// tem. Uma dependência a menos para manter — e o código é curto o bastante
// para ser conferido aqui, com o teste que decifra o que foi cifrado.

const enc = new TextEncoder()

export function paraBase64Url(bytes) {
  let s = ''
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function deBase64Url(texto) {
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((texto.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function juntar(...partes) {
  const total = partes.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let i = 0
  for (const p of partes) {
    out.set(p, i)
    i += p.length
  }
  return out
}

// HKDF completo (extract + expand) numa chamada: é o que a WebCrypto oferece.
async function hkdf(salt, ikm, info, bytes) {
  const chave = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, chave, bytes * 8)
  return new Uint8Array(bits)
}

// ---------- chaves VAPID ----------

// O par de chaves que identifica este servidor para os serviços de push
// (Apple, Google, Mozilla). Gerado uma vez e guardado — trocar o par
// invalidaria todas as inscrições já feitas.
export async function gerarChavesVapid() {
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const publica = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey))
  const privada = await crypto.subtle.exportKey('jwk', par.privateKey)
  return { publica: paraBase64Url(publica), privada }
}

// O cabeçalho Authorization de cada envio: um JWT curto, assinado com a
// chave privada, dizendo para qual serviço é e até quando vale.
export async function cabecalhoVapid(endpoint, chaves, contato, agoraMs = Date.now()) {
  const aud = new URL(endpoint).origin
  const cab = paraBase64Url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const corpo = paraBase64Url(
    enc.encode(JSON.stringify({ aud, exp: Math.floor(agoraMs / 1000) + 12 * 3600, sub: contato }))
  )
  const chave = await crypto.subtle.importKey('jwk', chaves.privada, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const assinatura = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chave, enc.encode(`${cab}.${corpo}`))
  return `vapid t=${cab}.${corpo}.${paraBase64Url(assinatura)}, k=${chaves.publica}`
}

// ---------- cifra do conteúdo (RFC 8291) ----------

// O serviço de push (o da Apple, no iPhone) só repassa bytes cifrados para
// a chave do aparelho: ele não consegue ler o título do compromisso.
export async function cifrarConteudo(inscricao, texto) {
  const uaPublica = deBase64Url(inscricao.keys.p256dh)
  const segredo = deBase64Url(inscricao.keys.auth)

  const efemera = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublica = new Uint8Array(await crypto.subtle.exportKey('raw', efemera.publicKey))
  const chaveDoAparelho = await crypto.subtle.importKey('raw', uaPublica, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const compartilhado = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: chaveDoAparelho }, efemera.privateKey, 256)
  )

  const ikm = await hkdf(segredo, compartilhado, juntar(enc.encode('WebPush: info\0'), uaPublica, asPublica), 32)
  const sal = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(sal, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(sal, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const chaveAes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // 0x02: delimitador do último (e único) registro.
  const claro = juntar(enc.encode(texto), new Uint8Array([2]))
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, chaveAes, claro))

  const rs = new Uint8Array([0, 0, 0x10, 0]) // tamanho do registro: 4096
  return juntar(sal, rs, new Uint8Array([asPublica.length]), asPublica, cifrado)
}

// Envia uma notificação. Devolve o status HTTP: 404/410 querem dizer que a
// inscrição morreu (app removido, permissão retirada) e deve ser esquecida.
export async function enviarPush(inscricao, conteudo, chaves, contato) {
  const corpo = await cifrarConteudo(inscricao, JSON.stringify(conteudo))
  const res = await fetch(inscricao.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await cabecalhoVapid(inscricao.endpoint, chaves, contato),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // Aviso que chega uma hora depois não serve para nada.
      TTL: '3600',
      Urgency: 'high',
    },
    body: corpo,
  })
  return res.status
}
