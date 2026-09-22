import { PRIORITY_LABEL } from './priority.js'

// Marca o evento como "registro de conclusão" criado pelo app, do mesmo jeito
// que os blocos de foco se identificam (FOCUS_TASK_PROP em focusStats.js).
// Serve para reconhecê-los depois sem depender do texto do título.
export const TASK_DONE_PROP = 'agendaTarefaConcluida'

// Um minuto: o registro só precisa existir para ficar no histórico do dia —
// os 15 minutos de antes ocupavam espaço visual na grade sem corresponder a
// nenhum tempo de fato gasto (ver a ressalva de occupiesTime abaixo).
const DURACAO_MS = 60 * 1000

// Reconhece um registro de conclusão pela marca que o app deixou, não pelo
// texto do título — que a pessoa pode reescrever no Google Calendar.
export function ehRegistroDeConclusao(event) {
  return Boolean(event?.extendedProperties?.private?.[TASK_DONE_PROP])
}

// O registro fica na hora em que a tarefa foi concluída, como um bloco de 1
// minuto — é o que responde "quando foi que eu terminei isso".
//
// Mas ele NÃO conta como tempo ocupado (ver occupiesTime em calendarPrefs.js).
// Sem essa exceção, concluir seis tarefas numa tarde carimbaria uma hora e
// meia de "ocupado" que nunca existiu, picotando os vãos livres do dia. O
// registro conta o que foi feito; quem conta o tempo gasto é o bloco de foco.
export function montarEventoDeConclusao(task, quando = new Date()) {
  const titulo = (task?.title || '').trim() || '(sem título)'
  const prioridade = PRIORITY_LABEL[task?.priority]
  const partes = ['Concluída pelo Segundo Cérebro.']
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
