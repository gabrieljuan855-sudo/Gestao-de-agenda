import { useEffect, useState, useCallback } from 'react'
import { initGoogleAuth, signIn, signOut, isConfigured } from './lib/googleAuth.js'
import { listAllEvents, createEvent, listAllTasks, createTask, completeTask } from './lib/googleApi.js'
import { rangeForView, shiftReference } from './lib/dates.js'
import QuickAdd from './components/QuickAdd.jsx'
import FocusTimer from './components/FocusTimer.jsx'
import Backlog from './components/Backlog.jsx'
import ViewToggle from './components/ViewToggle.jsx'
import DateNav from './components/DateNav.jsx'
import DayView from './components/DayView.jsx'
import WeekView from './components/WeekView.jsx'
import MonthView from './components/MonthView.jsx'

export default function App() {
  const [token, setToken] = useState(null)
  const [view, setView] = useState('day')
  const [events, setEvents] = useState([])
  const [tasks, setTasks] = useState([])
  const [activeTask, setActiveTask] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [reference, setReference] = useState(() => new Date())

  useEffect(() => {
    initGoogleAuth((newToken) => setToken(newToken))
  }, [])

  const reload = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const { timeMin, timeMax } = rangeForView(view, reference)
      const [evts, tks] = await Promise.all([
        listAllEvents({ timeMin, timeMax }),
        listAllTasks({ showCompleted }),
      ])
      setEvents(evts)
      setTasks(tks)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [token, showCompleted, view, reference])

  useEffect(() => {
    reload()
  }, [reload])

  async function handleCreateEvent(preview) {
    await createEvent({ title: preview.title, start: preview.start, end: preview.end })
    await reload()
  }

  async function handleCreateTask(preview) {
    await createTask({ title: preview.title, priority: preview.priority, due: preview.due })
    await reload()
  }

  function openDay(day) {
    setReference(day)
    setView('day')
  }

  async function handleCompleteTask(task) {
    await completeTask(task.id, task.tasklistId)
    if (activeTask?.id === task.id) setActiveTask(null)
    await reload()
  }

  if (!isConfigured()) {
    return (
      <div className="app-shell">
        <div className="card">
          <h2>Configuração necessária</h2>
          <p className="muted">
            Defina a variável <code>VITE_GOOGLE_CLIENT_ID</code> (veja o README) para habilitar o
            login com o Google e usar o Calendar/Tasks como base de dados.
          </p>
        </div>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="app-shell">
        <div className="card" style={{ textAlign: 'center' }}>
          <h2>Gestão de agenda</h2>
          <p className="muted">Conecte sua conta Google para ver sua agenda e tarefas.</p>
          <button className="primary" onClick={signIn}>Entrar com o Google</button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Gestão de agenda</h2>
        <button onClick={signOut}>Sair</button>
      </div>

      <QuickAdd onCreateEvent={handleCreateEvent} onCreateTask={handleCreateTask} />

      <FocusTimer activeTask={activeTask} onCycleComplete={reload} />

      <ViewToggle view={view} onChange={setView} />

      <DateNav
        view={view}
        reference={reference}
        onPrev={() => setReference((r) => shiftReference(view, r, -1))}
        onNext={() => setReference((r) => shiftReference(view, r, 1))}
        onToday={() => setReference(new Date())}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          {view === 'day' && <DayView date={reference} events={events} />}
          {view === 'week' && (
            <WeekView reference={reference} events={events} tasks={tasks} onSelectDay={openDay} />
          )}
          {view === 'month' && (
            <MonthView reference={reference} events={events} onSelectDay={openDay} />
          )}
        </div>
        <Backlog
          tasks={tasks}
          activeTaskId={activeTask?.id}
          onSelect={setActiveTask}
          onComplete={handleCompleteTask}
          showCompleted={showCompleted}
          onToggleShowCompleted={setShowCompleted}
        />
      </div>

      {loading && <p className="muted">Atualizando...</p>}
    </div>
  )
}
