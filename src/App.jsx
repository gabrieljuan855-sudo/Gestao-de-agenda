import { useEffect, useState, useCallback } from 'react'
import { initGoogleAuth, signIn, signOut, isConfigured } from './lib/googleAuth.js'
import { listEvents, createEvent, listTasks, createTask, completeTask } from './lib/googleApi.js'
import QuickAdd from './components/QuickAdd.jsx'
import FocusTimer from './components/FocusTimer.jsx'
import Backlog from './components/Backlog.jsx'
import ViewToggle from './components/ViewToggle.jsx'
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

  useEffect(() => {
    initGoogleAuth((newToken) => setToken(newToken))
  }, [])

  const reload = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const timeMin = new Date()
      timeMin.setDate(timeMin.getDate() - 7)
      const timeMax = new Date()
      timeMax.setDate(timeMax.getDate() + 35)
      const [evts, tks] = await Promise.all([
        listEvents({ timeMin, timeMax }),
        listTasks(),
      ])
      setEvents(evts)
      setTasks(tks)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [token])

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

  async function handleCompleteTask(task) {
    await completeTask(task.id)
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          {view === 'day' && <DayView date={new Date()} events={events} />}
          {view === 'week' && <WeekView reference={new Date()} events={events} />}
          {view === 'month' && <MonthView reference={new Date()} events={events} />}
        </div>
        <Backlog
          tasks={tasks}
          activeTaskId={activeTask?.id}
          onSelect={setActiveTask}
          onComplete={handleCompleteTask}
        />
      </div>

      {loading && <p className="muted">Atualizando...</p>}
    </div>
  )
}
