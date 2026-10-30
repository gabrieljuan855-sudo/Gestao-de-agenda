import { toDateInput, addDays } from './dates.js'

// O acesso ao Google Calendar que o app e o conector do Claude compartilham:
// listar agendas e compromissos e criar um compromisso. Mesmo motivo de
// googleTarefas.js — o código é um só, e cada lado entra com o `request` que
// carrega o seu token.

const CAL_BASE = 'https://www.googleapis.com/calendar/v3'

// O Google devolve no máximo 250 por vez e indica a próxima página. Sem seguir
// essa indicação, um período longo perdia eventos em silêncio — o que é pior
// do que falhar, porque a lista parece completa.
export const MAX_PAGINAS = 12

export function criarApiDaAgenda(request) {
  async function listCalendars() {
    const data = await request(`${CAL_BASE}/users/me/calendarList?minAccessRole=reader`)
    return (data.items || []).filter((cal) => cal.selected !== false)
  }

  async function listEvents({ timeMin, timeMax, calendarId = 'primary', q }) {
    const eventos = []
    let pageToken = null

    for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
      const params = new URLSearchParams({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      })
      // O "q" do Google só entra quando tem texto, pra esta função continuar
      // servindo o carregamento normal por período.
      if (q) params.set('q', q)
      if (pageToken) params.set('pageToken', pageToken)

      const data = await request(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`)
      for (const event of data.items || []) eventos.push({ ...event, calendarId })

      pageToken = data.nextPageToken
      if (!pageToken) break
    }

    return eventos
  }

  // Junta o resultado de várias agendas, decorando cada evento com a cor e o
  // nome da agenda de origem — o mesmo acabamento que listAllEvents e
  // searchEvents precisam, cada um com seu próprio período/filtro.
  async function listAcrossCalendars(calendars, params) {
    const perCalendar = await Promise.all(
      calendars.map((cal) =>
        listEvents({ ...params, calendarId: cal.id })
          .then((events) =>
            events.map((event) => ({
              ...event,
              calendarSummary: cal.summaryOverride || cal.summary,
              calendarColor: cal.backgroundColor,
              calendarIsPrimary: Boolean(cal.primary),
              // Para os avisos no modo "seguir o Google Agenda": evento que usa
              // o lembrete padrão só sabe quantos minutos são olhando a agenda.
              calendarDefaultReminders: cal.defaultReminders || [],
            }))
          )
          .catch((err) => {
            console.error(`Falha ao buscar eventos da agenda ${cal.summary}:`, err)
            return []
          })
      )
    )
    return perCalendar.flat()
  }

  // Busca eventos de todas as agendas marcadas como visíveis na conta do usuário
  // (não só a agenda principal), já que uma pessoa costuma ter várias agendas.
  // Cada evento sai marcado com a cor e o nome da agenda de origem, do jeito que
  // o próprio Google Calendar mostra.
  async function listAllEvents({ timeMin, timeMax }) {
    const calendars = await listCalendars()
    const events = await listAcrossCalendars(calendars, { timeMin, timeMax })
    return events.sort(
      (a, b) => new Date(a.start?.dateTime || a.start?.date) - new Date(b.start?.dateTime || b.start?.date)
    )
  }

  async function createEvent({
    title,
    start,
    end,
    description,
    location,
    recurrence,
    calendarId = 'primary',
    extendedProperties,
    criarVideochamada,
    allDay = false,
  }) {
    // conferenceDataVersion=1 é o que permite o Google criar o Meet: sem esse
    // parâmetro na URL, a API ignora silenciosamente o campo conferenceData
    // enviado no corpo, e o evento nasce sem link nenhum.
    const query = criarVideochamada ? '?conferenceDataVersion=1' : ''
    return request(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events${query}`, {
      method: 'POST',
      body: JSON.stringify({
        summary: title,
        description,
        location,
        // Dia inteiro é data sem hora, e o fim do Google é exclusivo: quem pede
        // "de 22 a 24" grava fim 25 — mesma regra de updateEvent.
        ...(allDay
          ? { start: { date: toDateInput(start) }, end: { date: toDateInput(addDays(end, 1)) } }
          : { start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } }),
        ...(recurrence ? { recurrence } : {}),
        ...(extendedProperties ? { extendedProperties } : {}),
        ...(criarVideochamada
          ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } }
          : {}),
      }),
    })
  }

  return { listCalendars, listEvents, listAcrossCalendars, listAllEvents, createEvent }
}
