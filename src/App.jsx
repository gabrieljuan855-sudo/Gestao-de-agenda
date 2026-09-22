import { useEffect, useState, useCallback } from 'react'
import { initGoogleAuth, signIn, signOut, retryAuth } from './lib/googleAuth.js'
import {
  listAllEvents,
  createEvent,
  updateEvent,
  moveEvent,
  deleteEvent,
  setEventPresence,
  listAllTasks,
  listCalendars,
  listTaskLists,
  createTask,
  completeTask,
  updateTask,
  reopenTask,
  deleteTask,
  prefetchFocusEvents,
  garantirLista,
  moverTarefa,
} from './lib/googleApi.js'
import {
  LISTA_ENTRADA,
  LISTA_PROXIMAS,
  LISTA_AGUARDANDO,
  LISTA_ALGUM_DIA,
  LISTAS_GTD,
  acharLista,
  projetosSemProximaAcao,
  agruparPorProjeto,
} from './lib/gtd.js'
import { enfileirar, descarregar, quantasPendentes } from './lib/outbox.js'
import { lerCacheDeAgenda, gravarCacheDeAgenda } from './lib/agendaCache.js'
import { parseQuickAdd } from './lib/nlp.js'
import { rangeForView, shiftReference, isSameDay, toDateInput } from './lib/dates.js'
import { findDefaultCalendar } from './lib/defaults.js'
import QuickAdd from './components/QuickAdd.jsx'
import Logo from './components/Logo.jsx'
import Rail from './components/Rail.jsx'
import FocusOverlay from './components/FocusOverlay.jsx'
import useFocusTimer from './lib/useFocusTimer.js'
import Backlog from './components/Backlog.jsx'
import Notes from './components/Notes.jsx'
import useNotes from './lib/useNotes.js'
import Entrada from './components/Entrada.jsx'
import Aguardando from './components/Aguardando.jsx'
import Projetos from './components/Projetos.jsx'
import Trabalho from './components/Trabalho.jsx'
import HorarioTrabalho from './components/HorarioTrabalho.jsx'
import { loadWorkSchedule } from './lib/schedule.js'
import ShortcutsOverlay from './components/ShortcutsOverlay.jsx'
import useAtalhos from './lib/useAtalhos.js'
import { montarEventoDeConclusao } from './lib/taskDoneEvent.js'
import useRevisao from './lib/useRevisao.js'
import Revisao from './components/Revisao.jsx'
import SearchPanel from './components/SearchPanel.jsx'
import PeriodBar from './components/PeriodBar.jsx'
import DayView from './components/DayView.jsx'
import WeekView from './components/WeekView.jsx'
import MonthView from './components/MonthView.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import EventEditor from './components/EventEditor.jsx'
import TaskEditor from './components/TaskEditor.jsx'
import CalendarSettings from './components/CalendarSettings.jsx'
import Banner from './components/Banner.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import {
  loadCalendarPrefs,
  saveCalendarPrefs,
  loadPresence,
  setPresence,
  presenceOf,
  occupiesTime,
  isInformational,
  needsPresence,
  isDeclined,
} from './lib/calendarPrefs.js'

// O Worker devolve o motivo de um login que falhou em /?erro_login=<codigo>
// (ver worker/auth.js). Sem traduzir isso para a tela, o usuário só via a tela
// de login de novo, sem nenhuma pista do que houve.
const MOTIVO_LOGIN = {
  pedido_incompleto: 'O Google não devolveu os dados do login. Tente de novo.',
  estado_invalido:
    'O cookie do login não voltou — costuma ser bloqueio de cookies no navegador, ou a tentativa ter demorado mais de 10 minutos. Tente de novo.',
  sem_refresh_token:
    'O Google não enviou a credencial de longa duração. Remova o acesso deste app em myaccount.google.com/permissions e entre de novo.',
  conta_nao_autorizada: 'Essa conta do Google não é a autorizada neste app.',
  access_denied: 'A permissão foi recusada na tela do Google.',
  redirect_uri_mismatch:
    'O endereço de retorno não confere com o cadastrado no Google Cloud (URIs de redirecionamento autorizados).',
}

// Lê e limpa o motivo da URL: deixá-lo ali faria o aviso reaparecer a cada
// recarregamento, muito depois de ter deixado de valer.
function motivoDoLogin() {
  const params = new URLSearchParams(window.location.search)
  const codigo = params.get('erro_login')
  if (!codigo) return null
  window.history.replaceState({}, '', window.location.pathname)
  return { codigo, texto: MOTIVO_LOGIN[codigo] || codigo }
}

// "Bom dia" em vez do nome do app no topo: quem abre isso é uma pessoa só, e
// ela já sabe onde está.
function greeting(date = new Date()) {
  const h = date.getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

export default function App() {
  // Booleano, e não o token: o token gira sozinho a cada renovação, e a tela
  // não tem nada a ver com o valor dele. Guardar a string aqui fazia cada
  // renovação disparar um recarregamento inteiro da agenda.
  const [signedIn, setSignedIn] = useState(false)
  const [view, setView] = useState('day')
  // Nasce do que sobrou da última sessão, não vazio: sem isso, abrir o app
  // sem rede (ou antes de listAllEvents/listAllTasks responderem) mostrava
  // uma agenda em branco indistinguível de "não tem nada marcado".
  const [events, setEvents] = useState(() => lerCacheDeAgenda().events)
  const [tasks, setTasks] = useState(() => lerCacheDeAgenda().tasks)
  const [activeTask, setActiveTask] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [reference, setReference] = useState(() => new Date())
  const [editingEvent, setEditingEvent] = useState(null)
  const [editingTask, setEditingTask] = useState(null)
  const [calendars, setCalendars] = useState(() => lerCacheDeAgenda().calendars)
  const [taskLists, setTaskLists] = useState([])
  // Onde a captura cai. Vazio só até a primeira carga terminar.
  const [entradaId, setEntradaId] = useState('')
  const [capturasPendentes, setCapturasPendentes] = useState(0)
  const [calendarPrefs, setCalendarPrefs] = useState({})
  const [presence, setPresenceState] = useState(() => loadPresence())
  const [showCalendarSettings, setShowCalendarSettings] = useState(false)
  const [authStatus, setAuthStatus] = useState('loading')
  const [loadError, setLoadError] = useState(null)
  const [loginError] = useState(motivoDoLogin)
  const [presenceError, setPresenceError] = useState(null)
  const [registroError, setRegistroError] = useState(null)
  const [agendaError, setAgendaError] = useState(null)
  // O horário de trabalho decide o que a tela Agora conta como "tempo livre"
  // e o que o Dia mostra como vão livre — mora aqui, e não dentro de Agora,
  // porque o DayView também precisa dele.
  const [workSchedule, setWorkSchedule] = useState(() => loadWorkSchedule())

  useEffect(() => {
    initGoogleAuth(setSignedIn, setAuthStatus)
  }, [])

  // As agendas e listas mudam raramente: basta buscar uma vez por sessão,
  // para alimentar os seletores de onde gravar.
  //
  // A Entrada é garantida aqui: ela precisa existir antes da primeira
  // captura, e criá-la sozinha evita que o app dependa de o usuário ter
  // montado a lista à mão no Google Tasks (que é o que acontece hoje com as
  // listas "Prioridade ...", e falha em silêncio quando não existem).
  useEffect(() => {
    if (!signedIn) return
    Promise.all([listCalendars(), listTaskLists()])
      .then(async ([cals, lists]) => {
        const writable = cals.filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
        setCalendars(writable)
        gravarCacheDeAgenda({ calendars: writable })
        setCalendarPrefs(loadCalendarPrefs(cals))
        try {
          // Em sequência, não em paralelo: criar quatro listas de uma vez é
          // justamente o tipo de rajada que a API do Tasks recusa.
          let atuais = lists
          for (const titulo of LISTAS_GTD) {
            const lista = await garantirLista(atuais, titulo)
            if (!atuais.some((l) => l.id === lista.id)) atuais = [...atuais, lista]
          }
          setTaskLists(atuais)
          setEntradaId(acharLista(atuais, LISTA_ENTRADA)?.id || '')
        } catch (err) {
          // Sem as listas a captura ainda funciona: cai na lista padrão do
          // Google. Melhor guardar no lugar errado do que perder o que a
          // pessoa acabou de tirar da cabeça.
          console.error('Não deu para garantir as listas do método:', err)
          setTaskLists(lists)
          setEntradaId(acharLista(lists, LISTA_ENTRADA)?.id || '')
        }
      })
      .catch((err) => console.error('Não deu para carregar agendas e listas:', err))
  }, [signedIn])

  const reload = useCallback(async () => {
    if (!signedIn) return
    setLoading(true)
    setLoadError(null)
    try {
      const { timeMin, timeMax } = rangeForView(view, reference)
      const [evts, tks] = await Promise.all([
        listAllEvents({ timeMin, timeMax }),
        listAllTasks({ showCompleted }),
      ])
      setEvents(evts)
      setTasks(tks)
      gravarCacheDeAgenda({ events: evts, tasks: tks })
    } catch (err) {
      // Engolir o erro deixava a tela com a agenda vazia, como se o dia não
      // tivesse nada marcado — indistinguível de estar tudo certo.
      console.error(err)
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }, [signedIn, showCompleted, view, reference])

  useEffect(() => {
    reload()
  }, [reload])

  // O contador de pomodoro por tarefa (Backlog) não pode depender só dos
  // eventos da view aberta na tela — quem está vendo o mês de setembro não
  // pode achar que uma tarefa nunca teve foco só porque os blocos dela ficaram
  // em agosto. Busca à parte, num período bem mais largo, atualizada quando
  // loga e ao fim de cada ciclo de foco (que é quando um bloco novo é gravado).
  const [focusEvents, setFocusEvents] = useState([])

  const reloadFocusEvents = useCallback(() => {
    if (!signedIn) return
    prefetchFocusEvents()
      .then(setFocusEvents)
      .catch((err) => console.error('Não foi possível carregar o histórico de blocos de foco:', err))
  }, [signedIn])

  useEffect(() => {
    reloadFocusEvents()
  }, [reloadFocusEvents])

  // O app nunca se atualizava sozinho: deixado aberto no bolso a tarde
  // inteira, um compromisso criado no computador só aparecia depois de uma
  // navegação manual — e a própria virada do dia passava batido, com a tela
  // de "hoje" presa na data em que foi aberta. Agora ele confere isso sempre
  // que volta a ficar visível (trocar de app e voltar, destravar o celular)
  // e, para quem deixa a tela ligada a noite toda sem minimizar nada, também
  // a cada alguns minutos.
  useEffect(() => {
    let lastToday = new Date()

    function checkAndReload() {
      if (document.visibilityState !== 'visible') return
      const now = new Date()
      // A referência só é empurrada se ainda apontava para o "hoje" de antes
      // da virada: navegar de propósito para outro dia não pode ser desfeito
      // só porque a meia-noite passou enquanto o app ficava aberto.
      setReference((r) => (isSameDay(r, lastToday) && !isSameDay(r, now) ? now : r))
      lastToday = now
      reload()
    }

    document.addEventListener('visibilitychange', checkAndReload)
    window.addEventListener('focus', checkAndReload)
    const id = setInterval(checkAndReload, 5 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', checkAndReload)
      window.removeEventListener('focus', checkAndReload)
      clearInterval(id)
    }
  }, [reload])

  async function handleCreateEvent(preview) {
    await createEvent({
      title: preview.title,
      start: preview.start,
      end: preview.end,
      calendarId: preview.calendarId || 'primary',
    })
    await reload()
  }

  async function handleCreateTask(preview) {
    await createTask({
      title: preview.title,
      priority: preview.priority,
      due: preview.due,
      tasklistId: preview.tasklistId || '@default',
    })
    await reload()
  }

  const gravarCaptura = useCallback(
    (texto, due = null) =>
      createTask({ title: texto, due, tasklistId: entradaId || '@default' }),
    [entradaId]
  )

  // Capturar não pode falhar: é o gesto que sustenta a confiança no sistema
  // inteiro. Se a rede não estiver lá (rua, elevador, prédio antigo), o texto
  // fica na fila local e sobe depois — a tela pode dizer "guardado" sem
  // mentir, porque está mesmo.
  const handleCapture = useCallback(
    async ({ texto, due }) => {
      try {
        await gravarCaptura(texto, due)
        await reload()
      } catch (err) {
        console.error('Captura foi para a fila local:', err)
        enfileirar(texto, due)
        setCapturasPendentes(quantasPendentes())
      }
    },
    [gravarCaptura, reload]
  )

  // A fila tenta esvaziar quando o app volta a ficar visível ou a rede
  // reaparece — os dois momentos em que ela tem chance real de subir.
  const descarregarFila = useCallback(async () => {
    if (!signedIn || quantasPendentes() === 0) return
    const { enviados, restantes } = await descarregar((texto, due) => gravarCaptura(texto, due))
    setCapturasPendentes(restantes)
    if (enviados > 0) await reload()
  }, [signedIn, gravarCaptura, reload])

  useEffect(() => {
    setCapturasPendentes(quantasPendentes())
    if (!signedIn) return
    descarregarFila()
    window.addEventListener('online', descarregarFila)
    document.addEventListener('visibilitychange', descarregarFila)
    return () => {
      window.removeEventListener('online', descarregarFila)
      document.removeEventListener('visibilitychange', descarregarFila)
    }
  }, [signedIn, descarregarFila])

  // Captura por URL: abrir /?capturar=texto guarda na Entrada e pronto.
  //
  // É o que destrava a captura de verdade no iPhone, onde PWA não tem
  // compartilhamento do sistema: dá para montar um Atalho ("Ei Siri, anotar")
  // ou um toque nas costas do aparelho que abre esse endereço. Sem isso, a
  // captura fora da mesa dependia de abrir o app, esperar carregar e achar o
  // campo — tempo suficiente para a pessoa desistir e deixar na cabeça.
  const [capturaDaUrl, setCapturaDaUrl] = useState(null)

  useEffect(() => {
    const texto = new URLSearchParams(window.location.search).get('capturar')
    if (!texto || !texto.trim() || !signedIn || !entradaId) return
    // Limpa a URL antes de gravar: se a pessoa recarregar a página depois,
    // não pode capturar a mesma coisa de novo.
    window.history.replaceState({}, '', window.location.pathname)
    const textoLimpo = texto.trim()
    // Mesmo reconhecimento de data do QuickAdd: "atualizar PLANCOM amanhã"
    // vindo de um Atalho do iOS também vira prazo, não só quando digitado
    // dentro do app. Um evento (dia+hora certos) não faz sentido aqui — a
    // captura por URL sempre vira tarefa, então só a data importa.
    const preview = parseQuickAdd(textoLimpo)
    handleCapture({ texto: textoLimpo, due: preview.type === 'task' ? preview.due : null })
      .then(() => setCapturaDaUrl(textoLimpo))
      .catch(() => setCapturaDaUrl(textoLimpo))
  }, [signedIn, entradaId, handleCapture])

  function openDay(day) {
    setReference(day)
    setView('day')
  }

  const focus = useFocusTimer({
    activeTask,
    onCycleComplete: () => {
      reload()
      reloadFocusEvents()
    },
  })
  const notesState = useNotes({ signedIn })
  // Qual painel do trilho está aberto. Mora aqui, e não dentro do Rail, porque
  // os atalhos de teclado também precisam abrir e fechar esses painéis.
  const [railAberto, setRailAberto] = useState(null)
  const [mostrandoAtalhos, setMostrandoAtalhos] = useState(false)
  // Qual face do trabalho está aberta no painel lateral. Começa em Próximas
  // porque é a pergunta do dia a dia ("o que eu faço agora"); a Entrada se
  // anuncia sozinha pelo contador na aba quando tem algo esperando.
  const [abaTrabalho, setAbaTrabalho] = useState('proximas')
  const [editandoHorario, setEditandoHorario] = useState(false)

  function abrirOuFechar(id) {
    setRailAberto((atual) => (atual === id ? null : id))
  }

  useAtalhos({
    criar: () => abrirOuFechar('add'),
    // Entrada, Próximas, Aguardando e Revisão deixaram de ser painéis que
    // abrem e fecham: são abas do painel que já está aberto, então a tecla
    // seleciona em vez de alternar.
    entrada: () => setAbaTrabalho('entrada'),
    proximas: () => setAbaTrabalho('proximas'),
    projetos: () => setAbaTrabalho('projetos'),
    aguardando: () => setAbaTrabalho('aguardando'),
    revisao: () => setAbaTrabalho('revisao'),
    notas: () => abrirOuFechar('notes'),
    buscar: () => abrirOuFechar('search'),
    'vista-dia': () => setView('day'),
    'vista-semana': () => setView('week'),
    'vista-mes': () => setView('month'),
    hoje: () => setReference(new Date()),
    anterior: () => setReference((r) => shiftReference(view, r, -1)),
    proximo: () => setReference((r) => shiftReference(view, r, 1)),
    ajuda: () => setMostrandoAtalhos((atual) => !atual),
  })
  const occupies = (event) => occupiesTime(event, calendarPrefs, presence)
  const declined = (event) => isDeclined(event, presence)

  async function handleSetPresence(event, value) {
    // Marca na hora e grava depois: quem tocou no botão não precisa esperar a
    // rede para ver a própria escolha.
    setPresenceState(setPresence(event.id, value))
    setPresenceError(null)
    try {
      await setEventPresence(event, value)
      await reload()
    } catch (err) {
      // Agenda só de leitura, ou sem permissão de escrita: a escolha continua
      // valendo neste aparelho — é preciso dizer que só aqui.
      console.error('Não deu para gravar a presença no Google:', err)
      setPresenceError('A escolha foi guardada só neste aparelho: o Google não deixou gravar nesta agenda.')
    }
  }

  function handleCalendarPrefs(next) {
    setCalendarPrefs(next)
    saveCalendarPrefs(next)
  }

  // Trocar de tarefa com um foco rodando deixava o pomodoro preso a uma tarefa
  // que não é mais a selecionada, e o evento gravado no fim do bloco podia
  // levar o título errado. Agora a troca avisa e encerra o foco em andamento
  // antes de valer — sem isso, o vínculo entre a lista e o pomodoro é só de
  // aparência.
  function focoEmAndamento() {
    return focus.phase === 'focus' || focus.phase === 'break'
  }

  // A confirmação de trocar de tarefa com o foco rodando fica pendente aqui
  // em vez de usar window.confirm: o diálogo nativo aparece com a cara do
  // sistema operacional, sem o tema do app — o ConfirmDialog renderizado lá
  // embaixo é que decide, chamando applySwitch quando o usuário confirma.
  const [pendingSwitch, setPendingSwitch] = useState(null)

  function applySwitch(task, thenStart) {
    if (activeTask && task.id !== activeTask.id && focoEmAndamento()) focus.stop()
    setActiveTask(task)
    if (thenStart) focus.start(task)
  }

  function switchActiveTask(task, { thenStart = false } = {}) {
    if (activeTask && task.id !== activeTask.id && focoEmAndamento()) {
      setPendingSwitch({ task, thenStart })
      return
    }
    applySwitch(task, thenStart)
  }

  // Botão "Focar" do card da tarefa: seleciona e já inicia o bloco de 25min
  // num só clique. Clicar nele na própria tarefa que já está em foco só volta
  // para a tela cheia, em vez de reiniciar o tempo já andado.
  function handleFocusTask(task) {
    if (activeTask?.id === task.id && focoEmAndamento()) {
      focus.openImmersive()
      return
    }
    switchActiveTask(task, { thenStart: true })
  }

  // Todos os caminhos de concluir (lista, editor, tela de foco, agente) passam
  // por aqui, então é aqui que o registro na agenda entra — uma vez só.
  async function handleCompleteTask(task) {
    await completeTask(task.id, task.tasklistId)
    // A tarefa já está concluída: se o registro falhar, isso não pode desfazer
    // nem travar nada. Mas também não pode sumir calado, senão a pessoa acha
    // que tem um histórico que não existe.
    try {
      await createEvent(montarEventoDeConclusao(task))
      setRegistroError(null)
    } catch (err) {
      console.error('Não foi possível registrar a conclusão na agenda:', err)
      setRegistroError(`"${task.title}" foi concluída, mas não deu para registrar na agenda.`)
    }
    if (activeTask?.id === task.id) {
      // Também fecha um ciclo em 'done': concluir a tarefa ali mesmo (pelo
      // atalho da tela de foco) deve voltar para o repouso, não deixar a tela
      // presa esperando um "novo bloco" de uma tarefa que já acabou.
      if (focus.phase !== 'idle') focus.stop()
      setActiveTask(null)
    }
    await reload()
  }

  // ---------- Esclarecer a Entrada ----------
  //
  // Cada decisão é a mesma operação por baixo: mover a tarefa da Entrada para
  // a lista que corresponde ao que ela é, ajustando o título e as etiquetas
  // no caminho. Sair da Entrada é o que marca o item como processado — não há
  // estado "já pensei nisso" separado para esquecer de atualizar.
  const idDaLista = useCallback(
    (titulo) => acharLista(taskLists, titulo)?.id || '',
    [taskLists]
  )

  // A revisão semanal é sob demanda (useRevisao), mas o hook ainda precisa
  // ser chamado sempre na mesma posição do render — por isso mora aqui, antes
  // dos retornos antecipados de login, mesmo que os dados que ela usa só
  // fiquem completos depois que a conta carrega.
  const entradaVaziaAgora = !tasks.some(
    (t) => t.status !== 'completed' && Boolean(entradaId) && t.tasklistId === entradaId
  )
  const revisao = useRevisao({
    idProximas: idDaLista(LISTA_PROXIMAS),
    idAguardando: idDaLista(LISTA_AGUARDANDO),
    entradaVazia: entradaVaziaAgora,
  })

  async function moverEsclarecido(item, listaTitulo, patch) {
    const destino = idDaLista(listaTitulo)
    if (!destino) throw new Error(`a lista "${listaTitulo}" não existe na sua conta`)
    await moverTarefa(item, destino, patch)
    await reload()
  }

  function handleProximaAcao(item, { titulo, contexto, projeto, duracao, priority }) {
    return moverEsclarecido(item, LISTA_PROXIMAS, { title: titulo, contexto, projeto, duracao, priority })
  }

  // Aguardando e Algum dia mandando de volta para o jogo: mesma lista de
  // sempre, só que no sentido contrário. Contexto e projeto continuam
  // valendo — reativar não é recomeçar do zero —, mas a espera (quem, desde
  // quando) precisa sumir explicitamente: sem isso a tarefa voltaria para
  // Próximas ações carregando uma etiqueta "~ana" que não faz mais sentido lá.
  function handleReativar(task) {
    return moverEsclarecido(task, LISTA_PROXIMAS, { aguardando: null })
  }

  function handleAguardando(item, { titulo, quem }) {
    return moverEsclarecido(item, LISTA_AGUARDANDO, {
      title: titulo,
      // A data de hoje é o "desde quando" da espera: é ela que permite dizer
      // "parado há 12 dias" na revisão, em vez de um limbo sem idade.
      aguardando: { quem, desde: toDateInput(new Date()) },
    })
  }

  function handleAlgumDia(item, { titulo }) {
    return moverEsclarecido(item, LISTA_ALGUM_DIA, { title: titulo })
  }

  // Virou compromisso: entra no calendário e sai das listas. O calendário só
  // recebe o que tem hora marcada de verdade — é o que o mantém confiável.
  async function handleAgendarDaEntrada(item, { titulo, start }) {
    const calendario = findDefaultCalendar(calendars) || calendars[0]
    await createEvent({
      title: titulo,
      start,
      end: new Date(start.getTime() + 60 * 60000),
      calendarId: calendario?.id || 'primary',
    })
    await deleteTask(item)
    await reload()
  }

  // Não pede ação nenhuma: vira anotação no Drive e deixa de ocupar espaço na
  // cabeça e na lista.
  async function handleReferencia(item, { titulo }) {
    notesState.createNote({ title: titulo, body: item.notesClean || '' })
    await deleteTask(item)
    await reload()
  }

  // Time-blocking da tela Agora: reserva o vão livre escolhido no Calendar
  // para a tarefa, do mesmo jeito que o bloco de foco reserva 25 minutos — a
  // diferença é que aqui quem escolhe a duração é a pessoa, não um relógio.
  // A tarefa continua existindo depois: o bloco é só o lembrete de quando
  // fazer, concluir continua sendo um gesto à parte.
  async function handleAgendarBloco(task, { start, end }) {
    const calendario = findDefaultCalendar(calendars) || calendars[0]
    const duracaoMax = (end - start) / 60000
    const minutos = Math.min(task.duracao || 30, duracaoMax)
    try {
      await createEvent({
        title: task.title,
        start,
        end: new Date(start.getTime() + minutos * 60000),
        calendarId: calendario?.id || 'primary',
      })
      setAgendaError(null)
      await reload()
    } catch (err) {
      console.error('Não deu para agendar o bloco:', err)
      setAgendaError(`Não deu para agendar "${task.title}": ${err.message}`)
    }
  }

  function handleWorkSchedule(next) {
    setWorkSchedule(next)
  }

  async function handleSaveEvent(patch) {
    // Mudar de agenda é uma chamada própria do Calendar (moveEvent), separada
    // do PATCH normal — e precisa vir primeiro: depois de mover, o evento só
    // existe na agenda de destino, então o PATCH dos outros campos já precisa
    // mirar lá, não na origem.
    const destino = patch.calendarId && patch.calendarId !== editingEvent.calendarId
      ? patch.calendarId
      : null
    if (destino) await moveEvent(editingEvent, destino)
    await updateEvent({ ...editingEvent, calendarId: destino || editingEvent.calendarId }, patch)
    await reload()
  }

  async function handleDeleteEvent() {
    await deleteEvent(editingEvent)
    await reload()
  }

  async function handleSaveTask(patch) {
    await updateTask(editingTask, patch)
    await reload()
  }

  async function handleDeleteTask() {
    if (activeTask?.id === editingTask.id) {
      if (focus.phase !== 'idle') focus.stop()
      setActiveTask(null)
    }
    await deleteTask(editingTask)
    await reload()
  }

  async function handleReopenTask() {
    await reopenTask(editingTask)
    await reload()
  }

  // Excluir recebendo a tarefa por parâmetro, para quem age sobre um item que
  // não está no modal de edição — hoje, a tela da Entrada mandando algo para
  // o lixo.
  async function handleExcluirTarefa(task) {
    if (activeTask?.id === task.id) {
      if (focus.phase !== 'idle') focus.stop()
      setActiveTask(null)
    }
    await deleteTask(task)
    await reload()
  }

  // Quem sabe se há login possível é o próprio módulo de autenticação: ele
  // pergunta ao Worker antes de olhar para a variável do build.
  if (authStatus === 'unconfigured') {
    return (
      <div className="app-shell">
        <div className="card">
          <h2>Configuração necessária</h2>
          <p className="muted">
            Configure o login no Worker (<code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> e{' '}
            <code>SESSION_SECRET</code>) ou defina <code>VITE_GOOGLE_CLIENT_ID</code> no build. O README
            explica os dois caminhos.
          </p>
        </div>
      </div>
    )
  }

  if (!signedIn) {
    return (
      <div className="app-shell">
        <div className="card" style={{ textAlign: 'center' }}>
          <Logo size={72} />
          <h2 style={{ marginTop: 12 }}>Segundo Cérebro</h2>
          <p className="muted">Conecte sua conta Google para ver sua agenda e tarefas.</p>
          {loginError && (
            <Banner tone="error">
              <strong>O login não foi concluído.</strong>
              <div style={{ marginTop: 4 }}>{loginError.texto}</div>
              <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>código: {loginError.codigo}</div>
            </Banner>
          )}
          {/* O botão só libera quando o script do Google está de pé: no celular
              ele chega depois da tela, e clicar antes não abria login nenhum. */}
          <button className="primary" onClick={signIn} disabled={authStatus !== 'ready'}>
            {authStatus === 'ready' ? 'Entrar com o Google' : 'Preparando o login...'}
          </button>
          {authStatus === 'unavailable' && (
            <div style={{ marginTop: 12 }}>
              <p className="muted">
                O login do Google não carregou. Verifique a conexão e tente de novo.
              </p>
              <button onClick={retryAuth}>Tentar de novo</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // O que está esperando decisão: tudo que ainda mora na Entrada. Não há
  // marca de "processado" — sair da lista É o processamento.
  const naEntrada = (t) => Boolean(entradaId) && t.tasklistId === entradaId
  const itensDaEntrada = tasks.filter((t) => t.status !== 'completed' && naEntrada(t))

  const idAguardando = idDaLista(LISTA_AGUARDANDO)
  const idAlgumDia = idDaLista(LISTA_ALGUM_DIA)
  const idProximas = idDaLista(LISTA_PROXIMAS)
  const naAguardando = (t) => Boolean(idAguardando) && t.tasklistId === idAguardando
  const noAlgumDia = (t) => Boolean(idAlgumDia) && t.tasklistId === idAlgumDia

  // A lista de tarefas mostra o que já foi decidido como próxima ação — não
  // tudo que não está na Entrada. Aguardando e Algum dia têm tela própria:
  // deixar os três juntos devolveria exatamente o amontoado que separar em
  // listas existe para desfazer. Tarefas fora do método (as antigas listas
  // "Prioridade ...", de antes desta reforma) continuam aparecendo aqui —
  // migrar é escolha de quem usa, não deste filtro.
  const tarefasEsclarecidas = tasks.filter((t) => !naEntrada(t) && !naAguardando(t) && !noAlgumDia(t))
  // Uma tarefa com projeto já tem casa própria na aba Projetos — deixá-la
  // também em Próximas ações duplicava a mesma tarefa nas duas telas. O Dia e
  // a Semana continuam mostrando `tarefasEsclarecidas` inteira: ali o que
  // importa é o prazo, não em qual aba a tarefa mora.
  const tarefasSemProjeto = tarefasEsclarecidas.filter((t) => !t.projeto)
  const tarefasAguardando = tasks.filter((t) => t.status !== 'completed' && naAguardando(t))
  const tarefasAlgumDia = tasks.filter((t) => t.status !== 'completed' && noAlgumDia(t))

  // Os contextos e os projetos que a pessoa já usa viram os botões da tela de
  // esclarecer, em vez de uma lista inventada por mim: o vocabulário é dela.
  const contextosUsados = [...new Set(tasks.map((t) => t.contexto).filter(Boolean))].sort()
  const projetosUsados = [...new Set(tasks.map((t) => t.projeto).filter(Boolean))].sort()

  // Um projeto sem nenhuma tarefa em Próximas ações parou de andar sem
  // ninguém perceber — é o único sinal do método que não aparece sozinho em
  // lugar nenhum da tela (atraso já pula aos olhos; isto não).
  const projetosParados = projetosSemProximaAcao(tasks, idProximas)

  const tools = [
    {
      id: 'add',
      label: 'Criar',
      // Desenhado, e não o caractere "+": glifo de texto muda de peso e de
      // forma conforme a fonte, e ficava fino e torto ao lado da lupa.
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      ),
      tecla: 'c',
      // No trilho de mesa, criar é a ação de maior destaque (o equivalente ao
      // FAB do MD3) — ganha a cor de primária mesmo parada, diferente das
      // outras ferramentas. Na barra inferior do celular esse realce não
      // entra (ver CSS): ali os quatro itens formam uma barra de abas, e dar
      // destaque fixo a um deles confundiria com o indicador de selecionado.
      primary: true,
      render: (close) => (
        <QuickAdd
          calendars={calendars}
          onCapture={handleCapture}
          onCreateEvent={handleCreateEvent}
          onDone={close}
        />
      ),
    },
    {
      id: 'search',
      label: 'Buscar',
      tecla: 'b',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <line x1="21" y1="21" x2="15.5" y2="15.5" />
        </svg>
      ),
      render: (close) => (
        <SearchPanel
          tasks={tasks}
          onSelectEvent={setEditingEvent}
          onSelectTask={setEditingTask}
          close={close}
        />
      ),
    },
    {
      id: 'notes',
      label: 'Anotações',
      // Anotação de caso é texto longo: precisa de largura para ser lida.
      wide: true,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="14" y2="17" />
        </svg>
      ),
      tecla: 'n',
      render: () => (
        <Notes
          notesState={notesState}
          calendars={calendars}
          taskLists={taskLists}
          onCreateEvent={handleCreateEvent}
          onCreateTask={handleCreateTask}
        />
      ),
    },
  ]

  // As quatro faces do mesmo material, no painel que fica sempre aberto ao
  // lado da agenda. A ordem é a do método: o que chegou, o que fazer, o que
  // espera alguém, e o olhar de fim de semana por cima de tudo.
  const abasDoTrabalho = [
    {
      id: 'entrada',
      label: 'Entrada',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h4l2 3h4l2-3h4" />
          <path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
          <path d="M4 12 6 4h12l2 8" />
        </svg>
      ),
      // O contador é o convite: uma Entrada com itens parados é o sinal de
      // que há coisa não decidida, e é o único número do app que pede ação.
      badge: itensDaEntrada.length,
      render: () => (
        <Entrada
          itens={itensDaEntrada}
          contextos={contextosUsados}
          projetos={projetosUsados}
          onProximaAcao={handleProximaAcao}
          onAguardando={handleAguardando}
          onAgendar={handleAgendarDaEntrada}
          onAlgumDia={handleAlgumDia}
          onReferencia={handleReferencia}
          onConcluir={handleCompleteTask}
          onExcluir={handleExcluirTarefa}
        />
      ),
    },
    {
      id: 'proximas',
      label: 'Próximas',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8l4 4-4 4" />
        </svg>
      ),
      render: () => (
        <Backlog
          tasks={tarefasSemProjeto}
          events={events}
          occupies={occupies}
          schedule={workSchedule}
          focusEvents={focusEvents}
          activeTaskId={activeTask?.id}
          focusingTaskId={focoEmAndamento() ? activeTask?.id : null}
          onFocus={handleFocusTask}
          onComplete={handleCompleteTask}
          onEdit={setEditingTask}
          onAgendar={handleAgendarBloco}
          showCompleted={showCompleted}
          onToggleShowCompleted={setShowCompleted}
        />
      ),
    },
    {
      id: 'projetos',
      label: 'Projetos',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
      ),
      render: () => (
        <Projetos
          grupos={agruparPorProjeto(tasks, idProximas)}
          onEdit={setEditingTask}
          onComplete={handleCompleteTask}
        />
      ),
    },
    {
      id: 'aguardando',
      label: 'Aguardando',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.5 2" />
        </svg>
      ),
      render: () => (
        <Aguardando
          aguardando={tarefasAguardando}
          algumDia={tarefasAlgumDia}
          onReativar={handleReativar}
          onConcluir={handleCompleteTask}
        />
      ),
    },
    {
      id: 'revisao',
      label: 'Revisão',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="4" width="12" height="16" rx="2" />
          <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      ),
      render: () => (
        <Revisao
          numeros={revisao.numeros}
          comentario={revisao.comentario}
          carregando={revisao.carregando}
          onGerar={revisao.gerar}
        />
      ),
    },
  ]

  return (
    <div className="app-shell">
      <div className="app-head">
        <div className="app-head-title">
          <Logo size={30} />
          <div>
            <h2>{greeting()}</h2>
            <div className="muted app-head-sub">Segundo Cérebro</div>
          </div>
        </div>
      </div>

      <PeriodBar
        view={view}
        onChangeView={setView}
        reference={reference}
        onPrev={() => setReference((r) => shiftReference(view, r, -1))}
        onNext={() => setReference((r) => shiftReference(view, r, 1))}
        onToday={() => setReference(new Date())}
      />

      <div className={view === 'day' ? 'workspace' : 'workspace workspace--wide'}>
        <div className="workspace-main">
          {/* `key={view}` reseta o limite de erro ao trocar de aba: um erro na
              Semana não deve continuar bloqueando depois de voltar para o Dia. */}
          <ErrorBoundary key={view}>
          {view === 'day' && (
            <DayView
              date={reference}
              events={events}
              tasks={tarefasEsclarecidas}
              onSelectEvent={setEditingEvent}
              onSelectTask={setEditingTask}
              occupies={occupies}
              declined={declined}
              isInfo={(e) => isInformational(e, calendarPrefs)}
              asksPresence={(e) => needsPresence(e, calendarPrefs)}
              presenceOf={(e) => presenceOf(e, presence)}
              onSetPresence={handleSetPresence}
              schedule={workSchedule}
            />
          )}
          {view === 'week' && (
            <WeekView
              reference={reference}
              events={events}
              tasks={tasks}
              onSelectDay={openDay}
              onSelectEvent={setEditingEvent}
              onSelectTask={setEditingTask}
              occupies={occupies}
              declined={declined}
              isInfo={(e) => isInformational(e, calendarPrefs)}
              schedule={workSchedule}
            />
          )}
          {view === 'month' && (
            <MonthView
              reference={reference}
              events={events}
              tasks={tasks}
              onSelectDay={openDay}
              onSelectEvent={setEditingEvent}
              onSelectTask={setEditingTask}
              occupies={occupies}
              declined={declined}
            />
          )}
          </ErrorBoundary>
        </div>
        <Trabalho abas={abasDoTrabalho} abaAtiva={abaTrabalho} onAbaChange={setAbaTrabalho} />

        <Rail tools={tools} openId={railAberto} onOpenChange={setRailAberto} />
      </div>

      <FocusOverlay focus={focus} onCompleteTask={handleCompleteTask} />

      {capturaDaUrl && (
        <Banner tone="info" actionLabel="Entendi" onAction={() => setCapturaDaUrl(null)}>
          Guardado na Entrada: "{capturaDaUrl}"
        </Banner>
      )}

      {capturasPendentes > 0 && (
        <Banner tone="warning" actionLabel="Tentar agora" onAction={descarregarFila}>
          {capturasPendentes === 1
            ? '1 captura ainda não subiu — está guardada neste aparelho e sobe sozinha quando a rede voltar.'
            : `${capturasPendentes} capturas ainda não subiram — estão guardadas neste aparelho e sobem sozinhas quando a rede voltar.`}
        </Banner>
      )}

      {projetosParados.length > 0 && (
        <Banner tone="warning">
          {projetosParados.length === 1
            ? `O projeto #${projetosParados[0]} não tem nenhuma próxima ação — parou de andar sem avisar.`
            : `${projetosParados.length} projetos sem próxima ação nenhuma (${projetosParados.map((p) => `#${p}`).join(', ')}) — pararam de andar sem avisar.`}
        </Banner>
      )}

      {presenceError && (
        <Banner tone="warning" actionLabel="Entendi" onAction={() => setPresenceError(null)}>
          {presenceError}
        </Banner>
      )}

      {registroError && (
        <Banner tone="warning" actionLabel="Entendi" onAction={() => setRegistroError(null)}>
          {registroError}
        </Banner>
      )}

      {agendaError && (
        <Banner tone="warning" actionLabel="Entendi" onAction={() => setAgendaError(null)}>
          {agendaError}
        </Banner>
      )}

      {loadError && (
        <Banner tone="error" actionLabel="Tentar de novo" onAction={reload}>
          Não deu para carregar a agenda: {loadError}
        </Banner>
      )}

      {revisao.error && (
        <Banner tone="warning" actionLabel="Entendi" onAction={revisao.dismissError}>
          {revisao.error}
        </Banner>
      )}

      {new Date().getDay() === 5 && !revisao.numeros && abaTrabalho !== 'revisao' && (
        <Banner tone="info" actionLabel="Ver revisão" onAction={() => setAbaTrabalho('revisao')}>
          É sexta — bom momento para revisar a semana.
        </Banner>
      )}

      {loading && <p className="muted">Atualizando...</p>}

      {editandoHorario && (
        <HorarioTrabalho
          schedule={workSchedule}
          onChange={handleWorkSchedule}
          onClose={() => setEditandoHorario(false)}
        />
      )}

      {showCalendarSettings && (
        <CalendarSettings
          calendars={calendars}
          prefs={calendarPrefs}
          onChange={handleCalendarPrefs}
          onClose={() => setShowCalendarSettings(false)}
        />
      )}

      {editingEvent && (
        <EventEditor
          event={editingEvent}
          calendars={calendars}
          onSave={handleSaveEvent}
          onDelete={handleDeleteEvent}
          onClose={() => setEditingEvent(null)}
        />
      )}

      {editingTask && (
        <TaskEditor
          task={editingTask}
          onSave={handleSaveTask}
          onDelete={handleDeleteTask}
          onReopen={handleReopenTask}
          onComplete={() => handleCompleteTask(editingTask)}
          onClose={() => setEditingTask(null)}
          contextos={contextosUsados}
          projetos={projetosUsados}
        />
      )}

      {pendingSwitch && (
        <ConfirmDialog
          title="Trocar de tarefa?"
          message="Trocar de tarefa agora encerra o foco em andamento (o bloco em curso não é gravado)."
          confirmLabel="Trocar mesmo assim"
          danger
          onConfirm={() => {
            const pending = pendingSwitch
            setPendingSwitch(null)
            applySwitch(pending.task, pending.thenStart)
          }}
          onCancel={() => setPendingSwitch(null)}
        />
      )}

      {mostrandoAtalhos && <ShortcutsOverlay onClose={() => setMostrandoAtalhos(false)} />}

      {/* Configuração e sair não competem por atenção com o trabalho: ficam no
          rodapé, discretos, onde se procura por configuração quando se
          precisa — não no cabeçalho, ao lado do que importa todo dia. */}
      <div className="app-footer">
        <button onClick={() => setShowCalendarSettings(true)}>Agendas</button>
        <button onClick={() => setEditandoHorario(true)}>Horário</button>
        <button onClick={signOut}>Sair</button>
      </div>
    </div>
  )
}
