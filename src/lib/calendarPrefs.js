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

// A confirmação é sua e privada: os eventos da agenda da gestão não têm lista
// de convidados, então não há RSVP do Google para responder, e alterar o
// evento mudaria ele para todo mundo que enxerga aquela agenda.
export function setPresence(eventId, value) {
  const all = read(PRESENCE_KEY)
  if (value) all[eventId] = value
  else delete all[eventId]
  write(PRESENCE_KEY, all)
  return all
}

export function presenceOf(event, presence) {
  return presence[event.id] || null
}

// "Não vou" é uma recusa, não um compromisso mais fraco: o evento continua na
// tela para você lembrar que ele existe, mas riscado, e sem ser anunciado como
// algo que está acontecendo com você.
export function isDeclined(event, presence) {
  return presence[event.id] === 'nao'
}

// Um evento só consome tempo se a agenda dele conta tempo e, quando a agenda
// pede confirmação, se você tiver confirmado presença.
export function occupiesTime(event, prefs, presence) {
  const pref = prefs[event.calendarId]
  if (!pref) return true
  if (!pref.occupies) return false
  if (pref.needsPresence) return presence[event.id] === 'vou'
  return true
}

export function isInformational(event, prefs) {
  return prefs[event.calendarId]?.occupies === false
}

export function needsPresence(event, prefs) {
  return prefs[event.calendarId]?.needsPresence === true
}
