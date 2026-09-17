import { ehRegistroDeConclusao } from './taskDoneEvent.js'
const PREFS_KEY = 'gestao-agenda:agendas'
const PRESENCE_KEY = 'gestao-agenda:presenca'

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {}
  } catch {
    return {}
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Sem permissão para guardar: vale só nesta aba.
  }
}

function normalize(text) {
  return (text || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

// Palpite inicial pelo nome da agenda, usado só enquanto não houver escolha
// salva: agenda de "informações" não consome tempo, agenda de "gestão" pede
// confirmação de presença. Tudo isso é editável no painel de agendas.
function defaultsFor(calendar) {
  const name = normalize(calendar.summaryOverride || calendar.summary)
  if (name.includes('informa')) return { occupies: false, needsPresence: false }
  if (name.includes('gest')) return { occupies: true, needsPresence: true }
  return { occupies: true, needsPresence: false }
}

export function loadCalendarPrefs(calendars) {
  const saved = read(PREFS_KEY)
  const prefs = {}
  for (const calendar of calendars) {
    prefs[calendar.id] = { ...defaultsFor(calendar), ...(saved[calendar.id] || {}) }
  }
  return prefs
}

export function saveCalendarPrefs(prefs) {
  write(PREFS_KEY, prefs)
}

export function loadPresence() {
  return read(PRESENCE_KEY)
}

// Nome da propriedade em que a escolha é gravada no próprio evento, para os
// compromissos em que não há convite a responder. O Google guarda isso na
// cópia do evento, então vale em todos os aparelhos.
export const PRESENCE_PROP = 'gestaoAgendaPresenca'

// Como o RSVP do Google se traduz no vocabulário do app.
const FROM_RSVP = { accepted: 'vou', declined: 'nao' }
export const TO_RSVP = { vou: 'accepted', nao: 'declined' }

// Guarda a escolha neste aparelho. Continua existindo como cache e como
// último recurso: numa agenda só de leitura não há o que gravar no Google.
export function setPresence(eventId, value) {
  const all = read(PRESENCE_KEY)
  if (value) all[eventId] = value
  else delete all[eventId]
  write(PRESENCE_KEY, all)
  return all
}

// A escolha gravada no Google manda, porque é a que vale em todo aparelho; o
// que está guardado aqui só entra quando o evento não traz nada. Antes só
// existia a versão local, e por isso marcar "não vou" no celular não aparecia
// no computador.
export function presenceOf(event, presence = {}) {
  const eu = (event.attendees || []).find((a) => a.self)
  if (eu && FROM_RSVP[eu.responseStatus]) return FROM_RSVP[eu.responseStatus]

  const noEvento = event.extendedProperties?.private?.[PRESENCE_PROP]
  if (noEvento) return noEvento

  return presence[event.id] || null
}

// "Não vou" é uma recusa, não um compromisso mais fraco: o evento continua na
// tela para você lembrar que ele existe, mas riscado, e sem ser anunciado como
// algo que está acontecendo com você.
export function isDeclined(event, presence) {
  return presenceOf(event, presence) === 'nao'
}

// Um evento só consome tempo se a agenda dele conta tempo e, quando a agenda
// pede confirmação, se você tiver confirmado presença.
export function occupiesTime(event, prefs, presence) {
  // Registro de tarefa concluída é histórico, não compromisso: ele aparece na
  // agenda mas não pode carimbar 15 minutos de "ocupado" que nunca existiram,
  // nem picotar os vãos livres do dia a cada tarefa marcada.
  if (ehRegistroDeConclusao(event)) return false
  const pref = prefs[event.calendarId]
  if (!pref) return true
  if (!pref.occupies) return false
  if (pref.needsPresence) return presenceOf(event, presence) === 'vou'
  return true
}

export function isInformational(event, prefs) {
  return prefs[event.calendarId]?.occupies === false
}

export function needsPresence(event, prefs) {
  return prefs[event.calendarId]?.needsPresence === true
}
