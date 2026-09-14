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

export default function Backlog({ tasks, activeTaskId, onSelect, onComplete }) {
  const sorted = [...tasks].sort((a, b) => ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority))

  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 10 }}>Backlog priorizado</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.length === 0 && <div className="muted">Nada no backlog. Use a busca acima para adicionar.</div>}
        {sorted.map((task) => {
          const age = daysSince(task.updated)
          const isActive = task.id === activeTaskId
          return (
            <div
              key={task.id}
              onClick={() => onSelect(task)}
              style={{
                border: isActive ? '2px solid #1f1e1c' : '1px solid var(--border)',
                borderRadius: 10,
                padding: '8px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{task.title}</div>
                <span className={`pill ${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
                {age !== null && age >= 3 && (
                  <span className="muted" style={{ marginLeft: 8 }}>parado há {age} dias</span>
                )}
              </div>
              <button onClick={(e) => { e.stopPropagation(); onComplete(task) }}>Concluir</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
