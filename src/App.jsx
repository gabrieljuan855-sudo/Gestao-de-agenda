import { useEffect, useState, useCallback } from 'react'
import { initGoogleAuth, signIn, signOut, isConfigured } from './lib/googleAuth.js'
import {
  listAllEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  listAllTasks,
  listCalendars,
  listTaskLists,
  createTask,
  completeTask,
  updateTask,
  reopenTask,
  deleteTask,
} from './lib/googleApi.js'
import { rangeForView, shiftReference } from './lib/dates.js'
import QuickAdd from './components/QuickAdd.jsx'
import FocusTimer from './components/FocusTimer.jsx'
import Backlog from './components/Backlog.jsx'
import Scratchpad from './components/Scratchpad.jsx'
import ViewToggle from './components/ViewToggle.jsx'
import DateNav from './components/DateNav.jsx'
import DayView from './components/DayView.jsx'
import WeekView from './components/WeekView.jsx'
import MonthView from './components/MonthView.jsx'
import EventEditor from './components/EventEditor.jsx'
import TaskEditor from './components/TaskEditor.jsx'
import CalendarSettings from './components/CalendarSettings.jsx'
import {
  loadCalendarPrefs,
  saveCalendarPrefs,
  loadPresence,
  setPresence,
  occupiesTime,
  isInformational,
  needsPresence,
  isDeclined,
} from './lib/calendarPrefs.js'

export default function App() {
  const [token, setToken] = useState(null)
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

  useEffect(() => {
    initGoogleAuth((newToken) => setToken(newToken))
  }, [])

  // As agendas e listas mudam raramente: basta buscar uma vez por sessão,
  // para alimentar os seletores de onde gravar.
  useEffect(() => {
    if (!token) return
    Promise.all([listCalendars(), listTaskLists()])
      .then(([cals, lists]) => {
        const writable = cals.filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
        setCalendars(writable)
        setCalendarPrefs(loadCalendarPrefs(cals))
        setTaskLists(lists)
      })
      .catch((err) => console.error('Não deu para carregar agendas e listas:', err))
  }, [token])

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

  const occupies = (event) => occupiesTime(event, calendarPrefs, presence)
  const declined = (event) => isDeclined(event, presence)

  function handleSetPresence(eventId, value) {
    setPresenceState(setPresence(eventId, value))
  }

  function handleCalendarPrefs(next) {
    setCalendarPrefs(next)
    saveCalendarPrefs(next)
  }

  async function handleCompleteTask(task) {
    await completeTask(task.id, task.tasklistId)
    if (activeTask?.id === task.id) setActiveTask(null)
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
    if (activeTask?.id === editingTask.id) setActiveTask(null)
    await deleteTask(editingTask)
    await reload()
  }

  async function handleReopenTask() {
    await reopenTask(editingTask)
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowCalendarSettings(true)}>Agendas</button>
          <button onClick={signOut}>Sair</button>
        </div>
      </div>

      <QuickAdd
        calendars={calendars}
        taskLists={taskLists}
        onCreateEvent={handleCreateEvent}
        onCreateTask={handleCreateTask}
      />

      <FocusTimer activeTask={activeTask} onCycleComplete={reload} />

      <ViewToggle view={view} onChange={setView} />

      <DateNav
        view={view}
        reference={reference}
        onPrev={() => setReference((r) => shiftReference(view, r, -1))}
        onNext={() => setReference((r) => shiftReference(view, r, 1))}
        onToday={() => setReference(new Date())}
      />

      <div className={view === 'day' ? 'main-grid' : 'main-grid main-grid--stacked'}>
        <div>
          {view === 'day' && (
            <DayView
              date={reference}
              events={events}
              onSelectEvent={setEditingEvent}
              occupies={occupies}
              declined={declined}
              isInfo={(e) => isInformational(e, calendarPrefs)}
              asksPresence={(e) => needsPresence(e, calendarPrefs)}
              presenceOf={(e) => presence[e.id] || null}
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
              occupies={occupies}
              declined={declined}
            />
          )}
          {view === 'month' && (
            <MonthView
              reference={reference}
              events={events}
              onSelectDay={openDay}
              onSelectEvent={setEditingEvent}
              occupies={occupies}
              declined={declined}
            />
          )}
        </div>
        <Backlog
          tasks={tasks}
          activeTaskId={activeTask?.id}
          onSelect={setActiveTask}
          onComplete={handleCompleteTask}
          onEdit={setEditingTask}
          showCompleted={showCompleted}
          onToggleShowCompleted={setShowCompleted}
        />
      </div>

      <Scratchpad />

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
    </div>
  )
}
