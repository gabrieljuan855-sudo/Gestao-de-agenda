import { PRIORITY_LABEL } from './priority.js'

// Marca o evento como "registro de conclusão" criado pelo app, do mesmo jeito
// que os blocos de foco se identificam (FOCUS_TASK_PROP em focusStats.js).
// Serve para reconhecê-los depois sem depender do texto do título.
export const TASK_DONE_PROP = 'agendaTarefaConcluida'

// Quinze minutos: o registro precisa de alguma duração para aparecer na grade
// do dia, e esse é o menor bloco que ainda dá para ler.
const DURACAO_MS = 15 * 60 * 1000

// Reconhece um registro de conclusão pela marca que o app deixou, não pelo
// texto do título — que a pessoa pode reescrever no Google Calendar.
export function ehRegistroDeConclusao(event) {
  return Boolean(event?.extendedProperties?.private?.[TASK_DONE_PROP])
}

// O registro fica na hora em que a tarefa foi concluída, como um bloco de 15
// minutos — é o que responde "quando foi que eu terminei isso".
//
// Mas ele NÃO conta como tempo ocupado (ver occupiesTime em calendarPrefs.js).
// Sem essa exceção, concluir seis tarefas numa tarde carimbaria uma hora e
// meia de "ocupado" que nunca existiu, picotando os vãos livres do dia. O
// registro conta o que foi feito; quem conta o tempo gasto é o bloco de foco.
export function montarEventoDeConclusao(task, quando = new Date()) {
  const titulo = (task?.title || '').trim() || '(sem título)'
  const prioridade = PRIORITY_LABEL[task?.priority]
  const partes = ['Concluída pelo Gestão de Agenda.']
  if (prioridade) partes.push(`Prioridade: ${prioridade}.`)
  if (task?.tasklistTitle) partes.push(`Lista: ${task.tasklistTitle}.`)

  return {
    title: `✓ ${titulo}`,
    start: quando,
    end: new Date(quando.getTime() + DURACAO_MS),
    description: partes.join(' '),
    ...(task?.id ? { extendedProperties: { private: { [TASK_DONE_PROP]: task.id } } } : {}),
  }
}
