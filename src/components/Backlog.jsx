import { useState } from 'react'
import { PRIORITY_LABEL, PRIORITY_ORDER, priorityFromListTitle } from '../lib/priority.js'
import { combinedFocusStats } from '../lib/focusStats.js'
import { formatDuration, dateOnlyFromISO } from '../lib/dates.js'
import { daysSince, isOverdueTask } from '../lib/tasks.js'

// Botão de ação da linha, só ícone — o rótulo continua existindo para
// leitor de tela e para quem passa o mouse (title).
function IconButton({ label, onClick, className = '', children }) {
  return (
    <button
      type="button"
      className={`icon-btn${className ? ` ${className}` : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

function FocusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 12 9 17 20 6" />
    </svg>
  )
}

function prazoLabel(due) {
  return dateOnlyFromISO(due).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

// Prioridade primeiro (é a dimensão que a pessoa escolhe de propósito);
// dentro da mesma prioridade, quem vence antes sobe — sem isso, uma tarefa
// de prioridade baixa vencendo hoje ficava perdida atrás de uma dúzia de
// tarefas de prioridade baixa sem prazo nenhum.
function compararTarefas(a, b) {
  const porPrioridade = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
  if (porPrioridade !== 0) return porPrioridade
  if (!a.due && !b.due) return 0
  if (!a.due) return 1
  if (!b.due) return -1
  return new Date(a.due) - new Date(b.due)
}

export default function Backlog({
  tasks,
  focusEvents = [],
  activeTaskId,
  focusingTaskId,
  onFocus,
  onComplete,
  onEdit,
  showCompleted,
  onToggleShowCompleted,
}) {
  // Só os contextos que aparecem aqui — filtrar por um contexto que não tem
  // tarefa nenhuma na lista seria um filtro que não filtra nada.
  const contextos = [...new Set(tasks.map((t) => t.contexto).filter(Boolean))].sort()
  const [filtro, setFiltro] = useState(null)

  const pending = tasks.filter((t) => t.status !== 'completed' && (!filtro || t.contexto === filtro))
  const completed = tasks.filter((t) => t.status === 'completed')
  const sorted = [...pending].sort(compararTarefas)

  function renderTask(task, { done = false } = {}) {
    const age = daysSince(task.updated)
    const isActive = task.id === activeTaskId
    const emFoco = task.id === focusingTaskId
    const stats = !done ? combinedFocusStats(task.id, focusEvents) : null
    const atrasada = !done && isOverdueTask(task)
    return (
      <div
        key={task.id}
        onClick={() => !done && onEdit(task)}
        style={{
          border: isActive ? '2px solid var(--on-surface)' : atrasada ? '1px solid var(--urgent)' : '1px solid var(--border)',
          borderRadius: 10,
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: done ? 'default' : 'pointer',
          opacity: done ? 0.6 : 1,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 'var(--body-md)', textDecoration: done ? 'line-through' : 'none' }}>
            {task.title}
          </div>
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
          {/* Listas como "Prioridade Máxima (menos de uma semana)" já estão
              ditas pela pílula ao lado: repetir o nome inteiro só empurrava o
              resto do cartão para baixo. Só listas com nome próprio aparecem. */}
          {task.tasklistTitle && !priorityFromListTitle(task.tasklistTitle) && (
            <span className="muted" style={{ marginLeft: 8, fontSize: 'var(--label-sm)' }}>{task.tasklistTitle}</span>
          )}
          {emFoco && <span className="muted" style={{ marginLeft: 8 }}>🍅 em foco agora</span>}
          {/* Contador de blocos já feitos nesta tarefa, guardado neste
              aparelho — é só um progresso visível, não um registro oficial. */}
          {stats && stats.sessions > 0 && (
            <span className="muted" style={{ marginLeft: 8, fontSize: 'var(--label-sm)' }}>
              🍅×{stats.sessions} · {formatDuration(stats.minutes)}
            </span>
          )}
          {!done && age !== null && age >= 3 && (
            <span className="muted" style={{ marginLeft: 8 }}>parado há {age} dias</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }}>
          {!done && onFocus && (
            <IconButton
              label={emFoco ? 'Ver foco' : 'Focar'}
              className={emFoco ? 'icon-btn--live' : ''}
              onClick={(e) => { e.stopPropagation(); onFocus(task) }}
            >
              <FocusIcon />
            </IconButton>
          )}
          {!done && (
            <IconButton label="Concluir" onClick={(e) => { e.stopPropagation(); onComplete(task) }}>
              <CheckIcon />
            </IconButton>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="muted">Próximas ações</div>
        <label className="muted" style={{ fontSize: 'var(--label-md)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => onToggleShowCompleted(e.target.checked)}
          />
          Mostrar concluídas
        </label>
      </div>

      {contextos.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {contextos.map((c) => (
            <button
              key={c}
              type="button"
              className={`pill-filtro${filtro === c ? ' is-escolhido' : ''}`}
              onClick={() => setFiltro((atual) => (atual === c ? null : c))}
            >
              @{c}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.length === 0 && (
          <div className="muted">
            {filtro ? `Nada com @${filtro} agora.` : 'Nada por aqui. Use o + ao lado para adicionar.'}
          </div>
        )}
        {sorted.map((task) => renderTask(task))}
        {showCompleted && completed.length > 0 && (
          <>
            <div className="muted" style={{ marginTop: 10, fontSize: 'var(--label-md)' }}>Concluídas</div>
            {completed.map((task) => renderTask(task, { done: true }))}
          </>
        )}
      </div>
    </div>
  )
}
