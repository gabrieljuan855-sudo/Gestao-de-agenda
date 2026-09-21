import { PRIORITY_LABEL } from '../lib/priority.js'
import { isOverdueTask } from '../lib/tasks.js'
import { dateOnlyFromISO } from '../lib/dates.js'

function prazoLabel(due) {
  return dateOnlyFromISO(due).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

// A pergunta desta aba não é "o que fazer agora" (isso é o Backlog) — é "o
// que cada projeto tem, e o que falta". Por isso não há filtro de contexto
// nem de tempo livre aqui: cada seção já é o filtro, por projeto.
export default function Projetos({ grupos, onEdit, onComplete }) {
  if (grupos.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 'var(--body-sm)', margin: 0 }}>
        Nenhuma tarefa com projeto ainda. Marcar um projeto acontece ao esclarecer um item da Entrada ou ao editar uma tarefa.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {grupos.map((grupo) => (
        <div key={grupo.projeto} className="entrada-bloco">
          <div className="entrada-bloco-titulo" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>#{grupo.projeto}</span>
            {grupo.semProximaAcao && (
              <span className="pill" style={{ background: 'var(--important-container)', color: 'var(--important)' }}>
                sem próxima ação
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {grupo.tarefas.map((task) => {
              const atrasada = isOverdueTask(task)
              return (
                <div
                  key={task.id}
                  onClick={() => onEdit(task)}
                  style={{
                    border: atrasada ? '1px solid var(--urgent)' : '1px solid var(--outline-variant)',
                    borderRadius: 'var(--shape-sm)',
                    padding: '8px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 'var(--body-md)' }}>{task.title}</div>
                    <span className={`pill ${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
                    {task.contexto && (
                      <span className="muted" style={{ marginLeft: 8, fontSize: 'var(--label-sm)' }}>@{task.contexto}</span>
                    )}
                    {task.due && (
                      <span
                        className="muted"
                        style={{ marginLeft: 8, fontSize: 'var(--label-sm)', color: atrasada ? 'var(--urgent)' : undefined }}
                      >
                        {atrasada ? 'atrasada · ' : 'prazo '}
                        {prazoLabel(task.due)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Concluir"
                    title="Concluir"
                    onClick={(e) => { e.stopPropagation(); onComplete(task) }}
                    style={{ flexShrink: 0, marginLeft: 8 }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 12 9 17 20 6" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
