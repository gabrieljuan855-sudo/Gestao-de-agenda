// O lado Google do conector: transformar o refresh token guardado na
// concessão (as `props`, cifradas pelo OAuthProvider) num access token, e
// falar com as APIs com ele. O `request` daqui tem o mesmo contrato do
// request() do app (googleApi.js) — devolve o JSON, null num 204, e lança erro
// com `status` e `body` —, e é isso que deixa as funções de src/lib/ rodarem
// iguais nos dois lados.

import { renovarAcesso } from '../auth.js'
import { faltaPermissaoDoDrive, driveApiDesativada, motivoDoGoogle } from '../../src/lib/driveErros.js'

// Erro com uma mensagem já escrita para o Claude ler e repassar. Os demais
// passam por traduzirErro.
export class ErroDoConector extends Error {}

export const MSG_RECONECTAR =
  'A autorização do Google usada pelo conector expirou ou foi revogada. Peça à pessoa para reconectar: no Claude, em Configurações > Conectores, desconectar o Segundo Cérebro e conectar de novo.'

// O access token do Google vale uma hora. Pedir um novo a cada ferramenta
// chamada seria uma ida a mais ao Google por pergunta, então ele fica em
// memória enquanto este isolate do Worker viver — perder o cache (o isolate
// reciclado) só custa uma renovação.
const cache = new Map()
const MARGEM_MS = 60 * 1000

async function chaveDe(refreshToken) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(refreshToken))
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
}

export async function tokenDeAcesso(env, props, { renovar = false, agora = Date.now() } = {}) {
  const refreshToken = props?.googleRefreshToken
  if (!refreshToken) throw new ErroDoConector(MSG_RECONECTAR)
  const chave = await chaveDe(refreshToken)
  const guardado = cache.get(chave)
  if (!renovar && guardado && guardado.expira - MARGEM_MS > agora) return guardado.token

  let tokens
  try {
    tokens = await renovarAcesso(env, refreshToken)
  } catch (err) {
    cache.delete(chave)
    // invalid_grant é o Google dizendo que a autorização morreu (revogada,
    // senha trocada, app ainda "em teste" com o prazo de 7 dias vencido).
    // Insistir não resolve; só reconectar.
    if (err.code === 'invalid_grant') throw new ErroDoConector(MSG_RECONECTAR)
    throw new ErroDoConector(`O Google não renovou o acesso agora (${err.message}). Tente de novo em instantes.`)
  }
  cache.set(chave, { token: tokens.access_token, expira: agora + Number(tokens.expires_in || 3600) * 1000 })
  return tokens.access_token
}

export function _limparCacheDeTokens() {
  cache.clear()
}

export function criarRequest(env, props) {
  return async function request(url, options = {}, { tentarDeNovo = true } = {}) {
    const token = await tokenDeAcesso(env, props)
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })
    // O Google recusou um token que o cache dava como bom (revogado no meio
    // da hora, por exemplo): renova e repete uma vez.
    if (res.status === 401 && tentarDeNovo) {
      await tokenDeAcesso(env, props, { renovar: true })
      return request(url, options, { tentarDeNovo: false })
    }
    if (!res.ok) {
      const body = await res.text()
      const err = new Error(`Erro na API do Google (${res.status}): ${body.slice(0, 300)}`)
      err.status = res.status
      err.body = body
      throw err
    }
    if (res.status === 204) return null
    return res.json()
  }
}

// O que o Claude lê quando algo falha. A detecção de "falta permissão" e de
// "API desligada" é a mesma que o app usa (driveErros.js); muda só o caminho
// de saída, que aqui é reconectar o conector, e não sair e entrar no app.
export function traduzirErro(err) {
  if (err instanceof ErroDoConector) return err.message
  if (driveApiDesativada(err)) {
    return 'A API do Google Drive não está ativada no projeto do Google Cloud deste app. Ative "Google Drive API" no console (APIs e serviços → Ativar APIs); reconectar não resolve.'
  }
  if (faltaPermissaoDoDrive(err)) {
    return 'A autorização do conector não inclui a permissão do Google Drive, onde ficam as anotações e os projetos. Reconecte o conector e deixe marcada a permissão do Drive na tela do Google.'
  }
  if (err?.status === 401) return MSG_RECONECTAR
  if (err?.status === 403) {
    return `O Google recusou o acesso (403${motivoDoGoogle(err) ? `: ${motivoDoGoogle(err).slice(0, 200)}` : ''}).`
  }
  if (err?.status === 404) return 'O Google não encontrou o item pedido (pode ter sido apagado ou movido).'
  if (err?.status === 429) return 'O Google limitou o número de pedidos por agora. Espere um pouco e tente de novo.'
  if (err?.status) {
    return `O Google respondeu com erro ${err.status}${motivoDoGoogle(err) ? `: ${motivoDoGoogle(err).slice(0, 200)}` : ''}.`
  }
  return `Falha inesperada: ${err?.message || String(err)}`
}
