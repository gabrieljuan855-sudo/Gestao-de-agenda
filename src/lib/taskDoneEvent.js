import { PRIORITY_LABEL } from './priority.js'

// Marca o evento como "registro de conclusão" criado pelo app, do mesmo jeito
// que os blocos de foco se identificam (FOCUS_TASK_PROP em focusStats.js).
// Serve para reconhecê-los depois sem depender do texto do título.
export const TASK_DONE_PROP = 'agendaTarefaConcluida'

// O registro de uma tarefa concluída é de DIA INTEIRO, e isso não é estética:
// concluir é um marco, não um intervalo. Um evento com hora inventaria uma
// duração que não aconteceu e, pior, entraria na conta de ocupação — os vãos
// livres do dia encolheriam a cada tarefa concluída (events.js só ignora o que
// é dia inteiro ao calcular vãos, "agora/próximo" e carga).
export function montarEventoDeConclusao(task, quando = new Date()) {
  const titulo = (task?.title || '').trim() || '(sem título)'
  const prioridade = PRIORITY_LABEL[task?.priority]
  const partes = ['Concluída pelo Gestão de Agenda.']
  if (prioridade) partes.push(`Prioridade: ${prioridade}.`)
  if (task?.tasklistTitle) partes.push(`Lista: ${task.tasklistTitle}.`)

  return {
    title: `✓ ${titulo}`,
    start: quando,
    end: quando,
    allDay: true,
    description: partes.join(' '),
    ...(task?.id ? { extendedProperties: { private: { [TASK_DONE_PROP]: task.id } } } : {}),
  }
}
