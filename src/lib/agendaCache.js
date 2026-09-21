// Cache local de tarefas/eventos/agendas: o que garante que a tela mostra
// algo na hora de abrir, mesmo sem rede — o mesmo papel que o cache de
// anotações (useNotes.js) já cumpre, só que para o que vem do Google
// Calendar e do Google Tasks.
//
// Sem merge por timestamp aqui: diferente das anotações (um blob único no
// Drive, sem controle de versão por item), Calendar e Tasks já resolvem
// conflito no servidor — cada evento/tarefa tem seu próprio id. Por isso o
// padrão é mais simples: grava o que a busca trouxe quando ela funciona,
// mantém o que já tinha quando ela falha.
const CACHE_KEY = 'gestao-agenda:cache-agenda'

export function lerCacheDeAgenda() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return {
      events: Array.isArray(parsed?.events) ? parsed.events : [],
      tasks: Array.isArray(parsed?.tasks) ? parsed.tasks : [],
      calendars: Array.isArray(parsed?.calendars) ? parsed.calendars : [],
    }
  } catch {
    return { events: [], tasks: [], calendars: [] }
  }
}

export function gravarCacheDeAgenda({ events, tasks, calendars }) {
  try {
    const atual = lerCacheDeAgenda()
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        events: events ?? atual.events,
        tasks: tasks ?? atual.tasks,
        calendars: calendars ?? atual.calendars,
      })
    )
  } catch {
    // Sem espaço ou sem localStorage: a tela continua funcionando com o que
    // já buscou nesta sessão, só não sobra nada para a próxima abertura.
  }
}
