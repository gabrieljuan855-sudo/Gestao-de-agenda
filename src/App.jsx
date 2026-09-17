import { useEffect, useState, useCallback } from 'react'
import { initGoogleAuth, signIn, signOut, retryAuth } from './lib/googleAuth.js'
import {
  listAllEvents,
  createEvent,
  updateEvent,
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
} from './lib/googleApi.js'
import { rangeForView, shiftReference, isSameDay } from './lib/dates.js'
import QuickAdd from './components/QuickAdd.jsx'
import Logo from './components/Logo.jsx'
import Rail from './components/Rail.jsx'
import FocusPanel from './components/FocusPanel.jsx'
import FocusOverlay from './components/FocusOverlay.jsx'
import useFocusTimer from './lib/useFocusTimer.js'
import Backlog from './components/Backlog.jsx'
import Notes from './components/Notes.jsx'
import useNotes from './lib/useNotes.js'
import SearchPanel from './components/SearchPanel.jsx'
import PeriodBar from './components/PeriodBar.jsx'
import DayView from './components/DayView.jsx'
import WeekView from './components/WeekView.jsx'
import MonthView from './components/MonthView.jsx'
import EventEditor from './components/EventEditor.jsx'
import TaskEditor from './components/TaskEditor.jsx'
import CalendarSettings from './components/CalendarSettings.jsx'
import Banner from './components/Banner.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import Briefing from './components/Briefing.jsx'
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
  const [events, setEvents] = useState([])
  const [tasks, setTasks] = useState([])
  const [activeTask, setActiveTask] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [reference, setReference] = useState(() => new Date())
  const [editingEvent, setEditingEvent] = useState(null)
  const [editingTask, setEditingTask] = useState(null)
  const [calendars, setCalendars] = useState([])
  const [taskLists, setTaskLists] = useState([])
  const [calendarPrefs, setCalendarPrefs] = useState({})
  const [presence, setPresenceState] = useState(() => loadPresence())
  const [showCalendarSettings, setShowCalendarSettings] = useState(false)
  const [authStatus, setAuthStatus] = useState('loading')
  const [loadError, setLoadError] = useState(null)
  const [loginError] = useState(motivoDoLogin)
  const [presenceError, setPresenceError] = useState(null)

  useEffect(() => {
    initGoogleAuth(setSignedIn, setAuthStatus)
  }, [])

  // As agendas e listas mudam raramente: basta buscar uma vez por sessão,
  // para alimentar os seletores de onde gravar.
  useEffect(() => {
    if (!signedIn) return
    Promise.all([listCalendars(), listTaskLists()])
      .then(([cals, lists]) => {
        const writable = cals.filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
        setCalendars(writable)
        setCalendarPrefs(loadCalendarPrefs(cals))
        setTaskLists(lists)
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

  function handleSelectTask(task) {
    switchActiveTask(task)
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

  async function handleCompleteTask(task) {
    await completeTask(task.id, task.tasklistId)
    if (activeTask?.id === task.id) {
      // Também fecha um ciclo em 'done': concluir a tarefa ali mesmo (pelo
      // atalho da tela de foco) deve voltar para o repouso, não deixar a tela
      // presa esperando um "novo bloco" de uma tarefa que já acabou.
      if (focus.phase !== 'idle') focus.stop()
      setActiveTask(null)
    }
    await reload()
  }

  async function handleSaveEvent(patch) {
    await updateEvent(editingEvent, patch)
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
          <h2 style={{ marginTop: 12 }}>Gestão de agenda</h2>
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

  const tools = [
    {
      id: 'add',
      label: 'Nova tarefa',
      icon: '+',
      // No trilho de mesa, criar é a ação de maior destaque (o equivalente ao
      // FAB do MD3) — ganha a cor de primária mesmo parada, diferente das
      // outras ferramentas. Na barra inferior do celular esse realce não
      // entra (ver CSS): ali os quatro itens formam uma barra de abas, e dar
      // destaque fixo a um deles confundiria com o indicador de selecionado.
      primary: true,
      render: (close) => (
        <QuickAdd
          calendars={calendars}
          taskLists={taskLists}
          onCreateEvent={handleCreateEvent}
          onCreateTask={handleCreateTask}
          onDone={close}
        />
      ),
    },
    {
      id: 'search',
      label: 'Buscar',
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
      id: 'focus',
      label: 'Pomodoro',
      // O botão mostra o tempo correndo, então dá para acompanhar o ciclo sem
      // abrir nada — era o que o cartão fixo fazia, ocupando a página inteira.
      // Em 'done' não há contagem correndo: mostra o rótulo de novo, mas segue
      // destacado, porque há um ciclo esperando decisão.
      icon: focus.phase === 'idle' || focus.phase === 'done' ? '25m' : focus.clock,
      highlight: focus.phase !== 'idle',
      render: () => <FocusPanel focus={focus} onCompleteTask={handleCompleteTask} events={events} occupies={occupies} />,
    },
    {
      id: 'notes',
      label: 'Anotações',
      icon: '≡',
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

  return (
    <div className="app-shell">
      <div className="app-head">
        <div className="app-head-title">
          <Logo size={30} />
          <div>
            <h2>{greeting()}</h2>
            <div className="muted app-head-sub">Gestão de agenda</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowCalendarSettings(true)}>Agendas</button>
          <button onClick={signOut}>Sair</button>
        </div>
      </div>

      <Briefing events={events} tasks={tasks} occupies={occupies} />

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
          {view === 'day' && (
            <DayView
              date={reference}
              events={events}
              onSelectEvent={setEditingEvent}
              occupies={occupies}
              declined={declined}
              isInfo={(e) => isInformational(e, calendarPrefs)}
              asksPresence={(e) => needsPresence(e, calendarPrefs)}
              presenceOf={(e) => presenceOf(e, presence)}
              onSetPresence={handleSetPresence}
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
        </div>
        <Backlog
          tasks={tasks}
          focusEvents={focusEvents}
          activeTaskId={activeTask?.id}
          focusingTaskId={focoEmAndamento() ? activeTask?.id : null}
          onSelect={handleSelectTask}
          onFocus={handleFocusTask}
          onComplete={handleCompleteTask}
          onEdit={setEditingTask}
          showCompleted={showCompleted}
          onToggleShowCompleted={setShowCompleted}
        />

        <Rail tools={tools} />
      </div>

      <FocusOverlay focus={focus} onCompleteTask={handleCompleteTask} />

      {presenceError && (
        <Banner tone="warning" actionLabel="Entendi" onAction={() => setPresenceError(null)}>
          {presenceError}
        </Banner>
      )}

      {loadError && (
        <Banner tone="error" actionLabel="Tentar de novo" onAction={reload}>
          Não deu para carregar a agenda: {loadError}
        </Banner>
      )}

      {loading && <p className="muted">Atualizando...</p>}

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
    </div>
  )
}
