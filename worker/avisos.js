import { gerarChavesVapid, enviarPush } from './push.js'

// Avisos com o app fechado.
//
// No iPhone, o app da Tela de Início é congelado assim que sai da tela: ele
// não tem como acordar sozinho para avisar. Então quem avisa é o servidor.
// Cada vez que o app abre, ele manda para cá a lista pronta dos avisos da
// próxima semana (quando, título, horário) — e só isso: o servidor não
// recebe acesso à conta Google nem lê a agenda por conta própria. Um Durable
// Object por pessoa guarda essa lista e marca um alarme para o próximo
// aviso; no alarme, manda a notificação para cada aparelho inscrito.

const MAX_AVISOS = 500
// Alarme que dispara um pouco antes pega os avisos destes segundos juntos,
// em vez de acordar várias vezes seguidas.
const FOLGA_MS = 15 * 1000
// Aviso que perdeu a hora por mais que isso (servidor parado, por exemplo)
// não é mandado: "Em 10 min" de uma reunião que já começou só confunde.
const ATRASO_MAXIMO_MS = 10 * 60 * 1000
const ID_DAS_CHAVES = '__chaves-vapid__'

function texto(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export function normalizarAvisos(lista, agoraMs) {
  return (Array.isArray(lista) ? lista : [])
    .map((a) => ({
      id: texto(a?.id, 200),
      quando: Number(a?.quando),
      titulo: texto(a?.titulo, 120) || 'Compromisso',
      corpo: texto(a?.corpo, 300),
      tag: texto(a?.tag, 120),
    }))
    .filter((a) => a.id && Number.isFinite(a.quando) && a.quando > agoraMs - ATRASO_MAXIMO_MS)
    .sort((a, b) => a.quando - b.quando)
    .slice(0, MAX_AVISOS)
}

export function avisosVencidos(avisos, enviados, agoraMs) {
  return avisos.filter(
    (a) => !enviados[a.id] && a.quando <= agoraMs + FOLGA_MS && a.quando > agoraMs - ATRASO_MAXIMO_MS
  )
}

export function proximoAlarme(avisos, enviados, agoraMs) {
  const futuro = avisos.find((a) => !enviados[a.id] && a.quando > agoraMs + FOLGA_MS)
  return futuro ? futuro.quando : null
}

// Lembra o que já saiu por um dia: reenviar a lista (o app abre várias vezes
// por dia) não pode repetir um aviso já dado.
export function podarEnviados(enviados, agoraMs) {
  const limite = agoraMs - 24 * 60 * 60 * 1000
  return Object.fromEntries(Object.entries(enviados || {}).filter(([, quando]) => quando >= limite))
}

export function inscricaoValida(i) {
  try {
    return (
      new URL(i?.endpoint).protocol === 'https:' &&
      typeof i?.keys?.p256dh === 'string' &&
      typeof i?.keys?.auth === 'string'
    )
  } catch {
    return false
  }
}

export class AvisosDoUsuario {
  constructor(ctx, env) {
    this.ctx = ctx
    this.env = env
  }

  async fetch(request) {
    const pedido = await request.json()
    const st = this.ctx.storage

    // Instância única que só guarda o par de chaves VAPID do servidor.
    if (pedido.op === 'chaves') {
      let chaves = await st.get('chaves')
      if (!chaves) {
        chaves = await gerarChavesVapid()
        await st.put('chaves', chaves)
      }
      return Response.json(chaves)
    }

    const agora = Date.now()
    const inscricoes = (await st.get('inscricoes')) || {}

    if (pedido.op === 'cancelar') {
      delete inscricoes[pedido.endpoint]
      await st.put('inscricoes', inscricoes)
      return Response.json({ ok: true, aparelhos: Object.keys(inscricoes).length })
    }

    if (pedido.op === 'atualizar') {
      if (pedido.inscricao) inscricoes[pedido.inscricao.endpoint] = pedido.inscricao
      await st.put('inscricoes', inscricoes)
      await st.put('chaves', pedido.chaves)
      await st.put('contato', pedido.contato)
      const avisos = normalizarAvisos(pedido.avisos, agora)
      await st.put('avisos', avisos)
      const enviados = podarEnviados(await st.get('enviados'), agora)
      await st.put('enviados', enviados)
      await this.agendar(avisos, enviados, agora)
      return Response.json({ ok: true, avisos: avisos.length, aparelhos: Object.keys(inscricoes).length })
    }

    return Response.json({ error: 'Operação desconhecida.' }, { status: 400 })
  }

  async agendar(avisos, enviados, agora) {
    const quando = avisosVencidos(avisos, enviados, agora).length ? agora : proximoAlarme(avisos, enviados, agora)
    if (quando === null) await this.ctx.storage.deleteAlarm()
    else await this.ctx.storage.setAlarm(quando)
  }

  async alarm() {
    const st = this.ctx.storage
    const agora = Date.now()
    const avisos = (await st.get('avisos')) || []
    const inscricoes = (await st.get('inscricoes')) || {}
    const chaves = await st.get('chaves')
    const contato = (await st.get('contato')) || 'mailto:avisos@segundo-cerebro.app'
    let enviados = podarEnviados(await st.get('enviados'), agora)

    const devidos = avisosVencidos(avisos, enviados, agora)
    if (chaves && devidos.length) {
      for (const aviso of devidos) {
        for (const [endpoint, inscricao] of Object.entries(inscricoes)) {
          try {
            const status = await enviarPush(inscricao, { titulo: aviso.titulo, corpo: aviso.corpo, tag: aviso.tag }, chaves, contato)
            if (status === 404 || status === 410) delete inscricoes[endpoint]
            else if (status >= 400) console.warn('push recusado', status, new URL(endpoint).host)
          } catch (err) {
            console.warn('push falhou', err?.message)
          }
        }
        enviados = { ...enviados, [aviso.id]: aviso.quando }
      }
      await st.put('inscricoes', inscricoes)
    }
    await st.put('enviados', enviados)
    await this.agendar(avisos, enviados, agora)
  }
}

// ---------- rotas ----------

async function chavesDoServidor(env) {
  const obj = env.AVISOS.get(env.AVISOS.idFromName(ID_DAS_CHAVES))
  const res = await obj.fetch('https://avisos/', { method: 'POST', body: JSON.stringify({ op: 'chaves' }) })
  return res.json()
}

// GET /api/avisos/chave → a chave pública para o aparelho se inscrever.
// POST /api/avisos → { inscricao?, avisos } guarda a inscrição deste aparelho
//   e a lista de avisos; { cancelar: endpoint } desinscreve o aparelho.
export async function handleAvisos(request, env, caller, json) {
  if (!env.AVISOS) return json({ error: 'Os avisos com o app fechado ainda não estão ativos no servidor.' }, 503)
  const url = new URL(request.url)

  if (url.pathname === '/api/avisos/chave') {
    const { publica } = await chavesDoServidor(env)
    return json({ publica })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Corpo inválido.' }, 400)
  }

  const usuario = env.AVISOS.get(env.AVISOS.idFromName(`usuario:${caller.email.toLowerCase()}`))
  const chamar = (pedido) =>
    usuario.fetch('https://avisos/', { method: 'POST', body: JSON.stringify(pedido) }).then((r) => r.json())

  if (typeof body?.cancelar === 'string') return json(await chamar({ op: 'cancelar', endpoint: body.cancelar }))

  if (body?.inscricao && !inscricaoValida(body.inscricao)) return json({ error: 'Inscrição inválida.' }, 400)
  const inscricao = body?.inscricao
    ? { endpoint: body.inscricao.endpoint, keys: { p256dh: body.inscricao.keys.p256dh, auth: body.inscricao.keys.auth } }
    : null
  const chaves = await chavesDoServidor(env)
  return json(
    await chamar({ op: 'atualizar', inscricao, avisos: body?.avisos, chaves, contato: `mailto:${caller.email}` })
  )
}
