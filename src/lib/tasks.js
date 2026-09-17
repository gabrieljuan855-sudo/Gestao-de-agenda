import { startOfDay } from './dates.js'

// Quantos dias desde a última mudança na tarefa — usado tanto pelo aviso
// "parado há N dias" do Backlog quanto pelo briefing do topo.
export function daysSince(dateString) {
  if (!dateString) return null
  const created = new Date(dateString)
  const diff = Date.now() - created.getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

// Mesmo limiar que o Backlog já usava para "parado há N dias".
const STALLED_DAYS = 3

export function isStalledTask(task) {
  if (task.status === 'completed') return false
  const age = daysSince(task.updated)
  return age !== null && age >= STALLED_DAYS
}

export function stalledTasks(tasks) {
  return tasks.filter(isStalledTask)
}

// Atrasada é diferente de "vence hoje": só depois que o dia do prazo já
// passou por completo.
export function isOverdueTask(task, now = new Date()) {
  if (!task.due || task.status === 'completed') return false
  return new Date(task.due) < startOfDay(now)
}

export function overdueTasks(tasks, now = new Date()) {
  return tasks.filter((t) => isOverdueTask(t, now))
}
