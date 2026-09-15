const PRIORITY_LABEL = {
  urgente: 'Urgente',
  importante: 'Importante',
  pode_esperar: 'Pode esperar',
}
const ORDER = ['urgente', 'importante', 'pode_esperar']

function daysSince(dateString) {
  if (!dateString) return null
  const created = new Date(dateString)
  const diff = Date.now() - created.getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

export default function Backlog({ tasks, activeTaskId, onSelect, onComplete, showCompleted, onToggleShowCompleted }) {
  const pending = tasks.filter((t) => t.status !== 'completed')
  const completed = tasks.filter((t) => t.status === 'completed')
  const sorted = [...pending].sort((a, b) => ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority))

  function renderTask(task, { done = false } = {}) {
    const age = daysSince(task.updated)
    const isActive = task.id === activeTaskId
    return (
      <div
        key={task.id}
        onClick={() => !done && onSelect(task)}
        style={{
          border: isActive ? '2px solid #1f1e1c' : '1px solid var(--border)',
          borderRadius: 10,
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: done ? 'default' : 'pointer',
          opacity: done ? 0.6 : 1,
        }}
      >
        <div>
          <div style={{ fontWeight: 500, fontSize: 14, textDecoration: done ? 'line-through' : 'none' }}>
            {task.title}
          </div>
          <span className={`pill ${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
          {task.tasklistTitle && (
            <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>{task.tasklistTitle}</span>
          )}
          {!done && age !== null && age >= 3 && (
            <span className="muted" style={{ marginLeft: 8 }}>parado há {age} dias</span>
          )}
        </div>
        {!done && <button onClick={(e) => { e.stopPropagation(); onComplete(task) }}>Concluir</button>}
      </div>
    )
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="muted">Backlog priorizado</div>
        <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => onToggleShowCompleted(e.target.checked)}
          />
          Mostrar concluídas
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.length === 0 && <div className="muted">Nada no backlog. Use a busca acima para adicionar.</div>}
        {sorted.map((task) => renderTask(task))}
        {showCompleted && completed.length > 0 && (
          <>
            <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>Concluídas</div>
            {completed.map((task) => renderTask(task, { done: true }))}
          </>
        )}
      </div>
    </div>
  )
}
