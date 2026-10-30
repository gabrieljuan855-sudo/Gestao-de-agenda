import { priorityFromListTitle, DEFAULT_PRIORITY } from './priority.js'
import { acharLista, parseMeta, encodeMeta } from './gtd.js'

// O acesso ao Google Tasks, com a função que faz a chamada autenticada vinda
// de fora. Morava dentro de googleApi.js, preso ao login do navegador; o
// conector do Claude (worker/conector) precisa ler e gravar tarefas
// exatamente do mesmo jeito — mesmas listas, mesmo bloco de metadados — e a
// única diferença entre os dois lados é de onde sai o token. Copiar estas
// funções para o Worker deixaria dois formatos para manter em sincronia; aqui
// o código é um só, e cada lado entra com o seu `request`.
//
// `request(url, options)` devolve o JSON da resposta (ou null num 204) e
// lança um erro com `status` e `body` quando o Google recusa.

const TASKS_BASE = 'https://www.googleapis.com/tasks/v1'

// A convenção de guardar metadado no começo da nota da tarefa mora em
// gtd.js (parseMeta/encodeMeta), que é lógica pura e tem teste. Aqui só se
// usa.

export function criarApiDeTarefas(request) {
  async function listTaskLists() {
    const data = await request(`${TASKS_BASE}/users/@me/lists`)
    return data.items || []
  }

  async function criarListaDeTarefas(titulo) {
    return request(`${TASKS_BASE}/users/@me/lists`, {
      method: 'POST',
      body: JSON.stringify({ title: titulo }),
    })
  }

  // Devolve a lista com esse nome, criando-a só se ainda não existir. É o que
  // permite a Entrada nascer sozinha no primeiro login, sem o usuário precisar
  // criar nada à mão no app do Google (diferente das listas "Prioridade ...",
  // que até hoje precisavam existir de antemão para o app funcionar direito).
  async function garantirLista(taskLists, titulo) {
    const existente = acharLista(taskLists, titulo)
    if (existente) return existente
    return criarListaDeTarefas(titulo)
  }

  async function listTasks({ tasklistId = '@default', tasklistTitle = '', showCompleted = false, completedMin = null } = {}) {
    const params = new URLSearchParams({
      showCompleted: String(showCompleted),
      showHidden: String(showCompleted),
      maxResults: '200',
    })
    if (completedMin) params.set('completedMin', completedMin.toISOString())
    const data = await request(`${TASKS_BASE}/lists/${encodeURIComponent(tasklistId)}/tasks?${params}`)
    // Ordem de decisão: a tag explícita manda; sem tag, vale o nome da lista
    // ("Prioridade Máxima (menos de uma semana)"); sem os dois, o padrão.
    const fromList = priorityFromListTitle(tasklistTitle)
    return (data.items || []).map((t) => {
      const meta = parseMeta(t.notes)
      return {
        ...t,
        priority: meta.priority || fromList || DEFAULT_PRIORITY,
        contexto: meta.contexto,
        projeto: meta.projeto,
        aguardando: meta.aguardando,
        duracao: meta.duracao,
        notesClean: meta.notes,
        tasklistId,
      }
    })
  }

  // Busca tarefas de todas as listas do usuário (equivalente às várias agendas
  // do Calendar), marcando cada tarefa com a lista de onde ela veio.
  async function listAllTasks({ showCompleted = false } = {}) {
    const lists = await listTaskLists()
    const perList = await Promise.all(
      lists.map((list) =>
        listTasks({ tasklistId: list.id, tasklistTitle: list.title, showCompleted })
          .then((tasks) => tasks.map((t) => ({ ...t, tasklistTitle: list.title })))
          .catch((err) => {
            console.error(`Falha ao buscar tarefas da lista ${list.title}:`, err)
            return []
          })
      )
    )
    return perList.flat()
  }

  // Só as concluídas desde uma data, de todas as listas. A página do projeto
  // precisa delas para mostrar o que já foi feito, mesmo com o "Mostrar
  // concluídas" desligado na tela principal — e buscar só a partir de uma data
  // evita trazer anos de histórico a cada abertura.
  async function listCompletedTasks({ completedMin }) {
    const lists = await listTaskLists()
    const perList = await Promise.all(
      lists.map((list) =>
        listTasks({ tasklistId: list.id, tasklistTitle: list.title, showCompleted: true, completedMin })
          .then((tasks) => tasks.filter((t) => t.status === 'completed').map((t) => ({ ...t, tasklistTitle: list.title })))
          .catch(() => [])
      )
    )
    return perList.flat()
  }

  async function createTask({
    title,
    priority = DEFAULT_PRIORITY,
    due,
    notes = '',
    contexto = null,
    projeto = null,
    aguardando = null,
    duracao = null,
    tasklistId = '@default',
  }) {
    return request(`${TASKS_BASE}/lists/${encodeURIComponent(tasklistId)}/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        notes: encodeMeta({ priority, contexto, projeto, aguardando, duracao }, notes),
        due: due ? due.toISOString() : undefined,
      }),
    })
  }

  async function completeTask(taskId, tasklistId = '@default') {
    return request(`${TASKS_BASE}/lists/${encodeURIComponent(tasklistId)}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' }),
    })
  }

  async function updateTask(task, { title, due, priority, notes, contexto, projeto, aguardando, duracao }) {
    const body = {}
    if (title !== undefined) body.title = title
    // O Google Tasks guarda só a data do prazo; a hora é ignorada pela API.
    if (due !== undefined) body.due = due ? due.toISOString() : null
    if (
      priority !== undefined ||
      notes !== undefined ||
      contexto !== undefined ||
      projeto !== undefined ||
      aguardando !== undefined ||
      duracao !== undefined
    ) {
      // O bloco é reescrito inteiro, então o que não veio no patch precisa vir
      // da tarefa — senão mudar só a prioridade apagaria o contexto. `??`
      // não serve aqui: ele trata `null` (a forma de *apagar* um campo, como
      // "não está mais esperando ninguém") igual a `undefined` (a forma de
      // "não mexi nisso"), e um reativar que manda `aguardando: null` para
      // encerrar a espera veria o valor antigo voltar sozinho.
      body.notes = encodeMeta(
        {
          priority: priority !== undefined ? priority : task.priority,
          contexto: contexto !== undefined ? contexto : task.contexto,
          projeto: projeto !== undefined ? projeto : task.projeto,
          aguardando: aguardando !== undefined ? aguardando : task.aguardando,
          duracao: duracao !== undefined ? duracao : task.duracao,
        },
        notes !== undefined ? notes : task.notesClean
      )
    }

    return request(`${TASKS_BASE}/lists/${encodeURIComponent(task.tasklistId || '@default')}/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  }

  async function reopenTask(task) {
    return request(`${TASKS_BASE}/lists/${encodeURIComponent(task.tasklistId || '@default')}/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'needsAction', completed: null }),
    })
  }

  async function deleteTask(task) {
    return request(`${TASKS_BASE}/lists/${encodeURIComponent(task.tasklistId || '@default')}/tasks/${task.id}`, {
      method: 'DELETE',
    })
  }

  // Mover de lista é o gesto central do esclarecer: sair da Entrada e virar
  // próxima ação, espera ou algum dia.
  //
  // A API tem um endpoint próprio para isso, que preserva o id da tarefa — mas
  // `destinationTasklist` é recente e nem toda conta responde a ele. Quando não
  // responde, o caminho é recriar no destino e apagar na origem. Isso troca o
  // id, e por isso a ordem importa: **cria primeiro**. Se apagasse antes e a
  // criação falhasse, o item sumiria — e perder o que a pessoa capturou é o
  // único erro que este app não pode cometer.
  async function moverTarefa(task, tasklistDestinoId, patch = {}) {
    const origem = task.tasklistId || '@default'
    const temPatch = Object.keys(patch).length > 0

    if (origem === tasklistDestinoId) {
      return temPatch ? updateTask(task, patch) : task
    }

    let movida = null
    try {
      movida = await request(
        `${TASKS_BASE}/lists/${encodeURIComponent(origem)}/tasks/${task.id}/move` +
          `?destinationTasklist=${encodeURIComponent(tasklistDestinoId)}`,
        { method: 'POST' }
      )
    } catch (err) {
      // Só a falha do *mover* leva ao plano B. Se o catch envolvesse também o
      // patch abaixo, um erro depois de a tarefa já ter mudado de lista faria
      // o plano B criar uma cópia — e a pessoa ficaria com a coisa duplicada.
      console.warn('Endpoint de mover não atendeu, recriando no destino:', err.message)
      // `!== undefined`, não `??`: um patch que manda `aguardando: null` está
      // encerrando a espera de propósito, e `??` devolveria o valor antigo.
      const nova = await createTask({
        title: patch.title !== undefined ? patch.title : task.title,
        priority: patch.priority !== undefined ? patch.priority : task.priority,
        due: patch.due !== undefined ? patch.due : task.due ? new Date(task.due) : null,
        notes: patch.notes !== undefined ? patch.notes : task.notesClean,
        contexto: patch.contexto !== undefined ? patch.contexto : task.contexto,
        projeto: patch.projeto !== undefined ? patch.projeto : task.projeto,
        aguardando: patch.aguardando !== undefined ? patch.aguardando : task.aguardando,
        duracao: patch.duracao !== undefined ? patch.duracao : task.duracao,
        tasklistId: tasklistDestinoId,
      })
      await deleteTask(task)
      return nova
    }

    if (!temPatch) return movida
    return updateTask({ ...task, ...movida, tasklistId: tasklistDestinoId }, patch)
  }

  return { listTaskLists, criarListaDeTarefas, garantirLista, listTasks, listAllTasks, listCompletedTasks, createTask, completeTask, updateTask, reopenTask, deleteTask, moverTarefa }
}
