import { isAllDay, eventStart, eventEnd } from './events.js'
import { ehRegistroDeConclusao } from './taskDoneEvent.js'

// Avisos no computador antes de cada compromisso.
//
// Não há servidor de push: quem avisa é o próprio app aberto (numa aba, mesmo
// em segundo plano, ou instalado). Foi uma escolha consciente — push de
// verdade pediria guardar a agenda da pessoa num servidor para saber quando
// avisar, e o app nunca guardou nada dela fora do Google.

const CHAVE_CONFIG = 'gestao-agenda:avisos'
const CHAVE_AVISADOS = 'gestao-agenda:avisos-feitos'

export const ANTECEDENCIAS = [5, 10, 15, 30, 60]
const CONFIG_PADRAO = { ativo: false, antecedencia: 10 }

export function normalizarConfigDeAvisos(c) {
  const antecedencia = c?.antecedencia === 'google' || ANTECEDENCIAS.includes(c?.antecedencia) ? c.antecedencia : CONFIG_PADRAO.antecedencia
  return { ativo: c?.ativo === true, antecedencia }
}

export function lerConfigDeAvisos() {
  try {
    return normalizarConfigDeAvisos(JSON.parse(localStorage.getItem(CHAVE_CONFIG)))
  } catch {
    return { ...CONFIG_PADRAO }
  }
}

export function gravarConfigDeAvisos(config) {
  try {
    localStorage.setItem(CHAVE_CONFIG, JSON.stringify(normalizarConfigDeAvisos(config)))
  } catch {
    // Sem localStorage vale só enquanto a aba estiver aberta.
  }
}

// Quantos minutos antes avisar. Em 'google', segue os lembretes de pop-up que
// a pessoa já configurou no Google Agenda (os do evento, ou os padrões da
// agenda quando o evento usa o padrão) — quem já acertou isso lá não precisa
// acertar de novo aqui. Sem lembrete de pop-up nenhum, não avisa.
export function minutosDeAviso(event, antecedencia) {
  if (antecedencia !== 'google') return [antecedencia]
  const r = event.reminders || { useDefault: true }
  const lista = r.useDefault ? event.calendarDefaultReminders || [] : r.overrides || []
  return [...new Set(lista.filter((x) => x?.method === 'popup' && Number.isFinite(x.minutes)).map((x) => x.minutes))]
}

function chaveDoAviso(event, inicio, minutos) {
  return `${event.id}|${inicio.toISOString()}|${minutos}`
}

// Os avisos que já deviam ter saído e ainda não saíram. Um por evento: se o
// app ficou fechado e dois lembretes do mesmo compromisso venceram juntos
// (30 e 10 min antes), sai só o mais próximo — os outros vão em `chaves`
// para serem dados como feitos, sem uma rajada de notificações repetidas.
export function avisosDevidos(events, agora, { antecedencia, avisados = new Set(), deveAvisar = () => true }) {
  const devidos = []
  for (const event of events || []) {
    if (!event?.id || event.status === 'cancelled' || isAllDay(event) || ehRegistroDeConclusao(event)) continue
    if (!deveAvisar(event)) continue
    const inicio = eventStart(event)
    if (!inicio || inicio <= agora) continue
    const vencidos = minutosDeAviso(event, antecedencia)
      .filter((m) => inicio.getTime() - m * 60000 <= agora.getTime())
      .map((m) => ({ m, chave: chaveDoAviso(event, inicio, m) }))
      .filter((x) => !avisados.has(x.chave))
    if (vencidos.length === 0) continue
    devidos.push({ event, inicio, chaves: vencidos.map((x) => x.chave) })
  }
  return devidos.sort((a, b) => a.inicio - b.inicio)
}

function hora(d) {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function textoDoAviso(event, agora) {
  const inicio = eventStart(event)
  const fim = eventEnd(event)
  const falta = Math.max(1, Math.round((inicio - agora) / 60000))
  const quando = falta >= 60 ? `Em ${Math.floor(falta / 60)}h${falta % 60 ? String(falta % 60).padStart(2, '0') : ''}` : `Em ${falta} min`
  const partes = [`${quando} · ${hora(inicio)}${fim && fim > inicio ? `–${hora(fim)}` : ''}`]
  if (event.location) partes.push(event.location)
  if (event.calendarSummary) partes.push(event.calendarSummary)
  return { titulo: event.summary?.trim() || '(sem título)', corpo: partes.join('\n') }
}

// Lembra o que já foi avisado entre um recarregamento e outro: sem isso,
// reabrir o app 5 minutos antes da reunião repetiria o aviso dado aos 10.
export function lerAvisados() {
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE_AVISADOS))
    return new Set(Array.isArray(lista) ? lista : [])
  } catch {
    return new Set()
  }
}

// Só guarda o que ainda pode importar: aviso de compromisso que começou há
// mais de um dia não volta a vencer.
export function podarAvisados(avisados, agora) {
  const limite = agora.getTime() - 24 * 60 * 60 * 1000
  return new Set([...avisados].filter((chave) => {
    const t = new Date(chave.split('|')[1]).getTime()
    return Number.isFinite(t) && t >= limite
  }))
}

export function gravarAvisados(avisados) {
  try {
    localStorage.setItem(CHAVE_AVISADOS, JSON.stringify([...avisados]))
  } catch {
    // Pior caso: um aviso repetido depois de recarregar a página.
  }
}
