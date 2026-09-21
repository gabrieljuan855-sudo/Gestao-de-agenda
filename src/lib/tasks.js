import { startOfDay, dateOnlyFromISO } from './dates.js'
import { PRIORITY_ORDER } from './priority.js'

// Quantos dias desde a última mudança na tarefa — usado tanto pelo aviso
// "parado há N dias" do Backlog quanto pelo briefing do topo. `now` é
// opcional (some chamadas, como a revisão semanal, precisam de uma data de
// referência fixa para o cálculo não mudar sozinho a cada dia que passa).
export function daysSince(dateString, now = new Date()) {
  if (!dateString) return null
  const created = new Date(dateString)
  const diff = now.getTime() - created.getTime()
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
  // dateOnlyFromISO, não `new Date(task.due)` — mesmo motivo do tasksDueOn
  // em events.js: o prazo vem como meia-noite UTC, e o fuso do Brasil jogava
  // isso um dia para trás.
  return dateOnlyFromISO(task.due) < startOfDay(now)
}

export function overdueTasks(tasks, now = new Date()) {
  return tasks.filter((t) => isOverdueTask(t, now))
}

// Prazo mais próximo primeiro; quem não tem prazo vai para o fim.
//
// O "sem prazo por último" não é detalhe de estética: sempre que esta lista é
// cortada (um teto de itens na tela ou num prompt), a tarefa que está mesmo
// para vencer não pode ficar de fora só porque a API do Google devolveu uma
// dúzia de tarefas sem data antes dela.
export function ordenarTarefasPorPrazo(tasks) {
  return tasks.slice().sort((a, b) => {
    if (!a.due && !b.due) return 0
    if (!a.due) return 1
    if (!b.due) return -1
    return new Date(a.due) - new Date(b.due)
  })
}

// Prioridade primeiro (é a dimensão que a pessoa escolhe de propósito);
// dentro da mesma prioridade, quem vence antes sobe — sem isso, uma tarefa
// de prioridade baixa vencendo hoje ficava perdida atrás de uma dúzia de
// tarefas de prioridade baixa sem prazo nenhum. Usada tanto pela lista de
// Próximas ações quanto pela tela Agora.
export function compararPorPrioridadeEPrazo(a, b) {
  const porPrioridade = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
  if (porPrioridade !== 0) return porPrioridade
  if (!a.due && !b.due) return 0
  if (!a.due) return 1
  if (!b.due) return -1
  return new Date(a.due) - new Date(b.due)
}
