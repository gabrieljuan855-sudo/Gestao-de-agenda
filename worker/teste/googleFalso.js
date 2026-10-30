// Um Google em memória — Tasks, Calendar e o Drive da appDataFolder — com o
// bastante para as funções de src/lib/ (googleTarefas, googleAgenda,
// driveArquivos) rodarem de verdade nos testes do conector. Só para testes.
//
// `request` tem o contrato do request() do app; `fetch` é o mesmo, no
// formato de fetch global (para os testes que passam pelo Worker inteiro).

let sequencia = 0
const novoId = (prefixo) => `${prefixo}${(++sequencia).toString(36)}`

export function googleFalso({ agora = () => new Date() } = {}) {
  const estado = {
    listas: [],
    tarefas: [], // { id, tasklistId, title, notes, due, status, updated, completed }
    agendas: [{ id: 'primary', summary: 'Pessoal', primary: true, accessRole: 'owner' }],
    eventos: [], // com calendarId
    arquivos: [], // { id, name, conteudo }
    chamadas: [],
  }

  function criarLista(title) {
    const lista = { id: novoId('lista'), title }
    estado.listas.push(lista)
    return lista
  }

  function criarTarefa(tasklistId, dados) {
    const t = { id: novoId('t'), tasklistId, title: '', notes: '', status: 'needsAction', updated: agora().toISOString(), ...dados }
    estado.tarefas.push(t)
    return t
  }

  const semDono = ({ tasklistId, ...resto }) => resto

  function responder(url, metodo, corpo) {
    const u = new URL(url)
    const p = decodeURIComponent(u.pathname)
    estado.chamadas.push(`${metodo} ${p}`)
    let m

    // ---- Tasks ----
    if (p === '/tasks/v1/users/@me/lists') {
      if (metodo === 'GET') return { items: estado.listas }
      if (metodo === 'POST') return criarLista(corpo.title)
    }
    if ((m = p.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks$/))) {
      const listaId = m[1]
      if (metodo === 'GET') {
        const comConcluidas = u.searchParams.get('showCompleted') === 'true'
        return {
          items: estado.tarefas
            .filter((t) => t.tasklistId === listaId && (comConcluidas || t.status !== 'completed'))
            .map(semDono),
        }
      }
      if (metodo === 'POST') return semDono(criarTarefa(listaId, { title: corpo.title, notes: corpo.notes, due: corpo.due }))
    }
    if ((m = p.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks\/([^/]+)\/move$/))) {
      const t = estado.tarefas.find((x) => x.id === m[2] && x.tasklistId === m[1])
      if (!t) return { status: 404 }
      t.tasklistId = u.searchParams.get('destinationTasklist')
      return semDono(t)
    }
    if ((m = p.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks\/([^/]+)$/))) {
      const t = estado.tarefas.find((x) => x.id === m[2] && x.tasklistId === m[1])
      if (!t) return { status: 404 }
      if (metodo === 'PATCH') {
        Object.assign(t, corpo, { updated: agora().toISOString() })
        if (corpo.status === 'completed') t.completed = agora().toISOString()
        return semDono(t)
      }
      if (metodo === 'DELETE') {
        estado.tarefas = estado.tarefas.filter((x) => x !== t)
        return null
      }
    }

    // ---- Calendar ----
    if (p === '/calendar/v3/users/me/calendarList') return { items: estado.agendas }
    if ((m = p.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/))) {
      const agendaId = m[1]
      if (metodo === 'GET') {
        const de = new Date(u.searchParams.get('timeMin'))
        const ate = new Date(u.searchParams.get('timeMax'))
        const inicio = (e) => new Date(e.start.dateTime || `${e.start.date}T03:00:00Z`)
        const fim = (e) => new Date(e.end.dateTime || `${e.end.date}T03:00:00Z`)
        return {
          items: estado.eventos
            .filter((e) => e.calendarId === agendaId && inicio(e) < ate && fim(e) > de)
            .map(({ calendarId, ...e }) => e),
        }
      }
      if (metodo === 'POST') {
        const e = { id: novoId('ev'), status: 'confirmed', ...corpo, calendarId: agendaId }
        estado.eventos.push(e)
        const { calendarId, ...semAgenda } = e
        return semAgenda
      }
    }

    // ---- Drive (appDataFolder) ----
    if (p === '/drive/v3/files' && metodo === 'GET') {
      const nome = (u.searchParams.get('q') || '').match(/name = '([^']+)'/)?.[1]
      return { files: estado.arquivos.filter((a) => a.name === nome).map((a) => ({ id: a.id })) }
    }
    if (p === '/drive/v3/files' && metodo === 'POST') {
      const a = { id: novoId('arq'), name: corpo.name, conteudo: '' }
      estado.arquivos.push(a)
      return { id: a.id }
    }
    if ((m = p.match(/^\/drive\/v3\/files\/([^/]+)$/)) && u.searchParams.get('alt') === 'media') {
      const a = estado.arquivos.find((x) => x.id === m[1])
      return a ? JSON.parse(a.conteudo || 'null') : { status: 404 }
    }
    if ((m = p.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/)) && metodo === 'PATCH') {
      const a = estado.arquivos.find((x) => x.id === m[1])
      a.conteudo = corpo
      return { id: a.id }
    }

    return { status: 404 }
  }

  function chamar(url, opcoes = {}) {
    const metodo = opcoes.method || 'GET'
    let corpo = opcoes.body
    // O Drive recebe o arquivo cru (texto); o resto, JSON.
    if (typeof corpo === 'string' && !url.includes('/upload/drive/')) corpo = JSON.parse(corpo)
    return responder(url, metodo, corpo)
  }

  return {
    estado,
    criarLista,
    criarTarefa,
    // Grava um arquivo do Drive como se o app tivesse gravado.
    gravarArquivo(nome, dados) {
      let a = estado.arquivos.find((x) => x.name === nome)
      if (!a) {
        a = { id: novoId('arq'), name: nome, conteudo: '' }
        estado.arquivos.push(a)
      }
      a.conteudo = JSON.stringify(dados)
    },
    lerArquivo(nome) {
      const a = estado.arquivos.find((x) => x.name === nome)
      return a ? JSON.parse(a.conteudo) : null
    },
    async request(url, opcoes) {
      const r = chamar(url, opcoes)
      if (r && typeof r.status === 'number' && Object.keys(r).length === 1) {
        const err = new Error(`Erro na API do Google (${r.status})`)
        err.status = r.status
        err.body = ''
        throw err
      }
      return r
    },
    async fetch(url, opcoes) {
      const r = chamar(String(url), opcoes)
      if (r && typeof r.status === 'number' && Object.keys(r).length === 1) return new Response('{}', { status: r.status })
      if (r === null) return new Response(null, { status: 204 })
      return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  }
}
