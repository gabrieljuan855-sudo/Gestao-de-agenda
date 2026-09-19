import { useState } from 'react'
import { PRIORITY_LABEL, priorityFromListTitle } from '../lib/priority.js'
import { combinedFocusStats } from '../lib/focusStats.js'
import { formatDuration, formatTime, dateOnlyFromISO } from '../lib/dates.js'
import { daysSince, isOverdueTask } from '../lib/tasks.js'
import { acoesParaAgora } from '../lib/agora.js'
import { findFreeGaps } from '../lib/events.js'
import { workBlocksFor } from '../lib/schedule.js'

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

function AgendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="12" y1="13" x2="12" y2="18" />
      <line x1="9.5" y1="15.5" x2="14.5" y2="15.5" />
    </svg>
  )
}

function prazoLabel(due) {
  return dateOnlyFromISO(due).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

export default function Backlog({
  tasks,
  events = [],
  occupies = () => true,
  schedule,
  focusEvents = [],
  activeTaskId,
  focusingTaskId,
  onFocus,
  onComplete,
  onEdit,
  onAgendar,
  showCompleted,
  onToggleShowCompleted,
}) {
  // Só os contextos que aparecem aqui — filtrar por um contexto que não tem
  // tarefa nenhuma na lista seria um filtro que não filtra nada.
  const contextos = [...new Set(tasks.map((t) => t.contexto).filter(Boolean))].sort()
  const [filtro, setFiltro] = useState(null)
  const [usarTempoLivre, setUsarTempoLivre] = useState(false)

  // Quanto tempo livre existe agora, de verdade: o vão entre os compromissos
  // de hoje, dentro do expediente. Isto era uma tela à parte ("Agora"), que
  // no fim mostrava esta mesma lista com dois filtros a mais — uma lente,
  // não um lugar.
  const agora = new Date()
  const vaoAgora =
    findFreeGaps(events, agora, workBlocksFor(agora, schedule), { occupies }).find(
      (g) => g.start <= agora && g.end > agora
    ) || null
  const minutosLivres = vaoAgora ? Math.round((vaoAgora.end - agora) / 60000) : null

  // Sem vão livre não há filtro de tempo para oferecer. A versão anterior
  // deixava o "só o que cabe agora" marcado mesmo assim, sem tempo nenhum
  // para comparar: a tela dizia "sem vão livre hoje" e listava tudo do mesmo
  // jeito, contradizendo a si mesma.
  const filtrandoPorTempo = Boolean(vaoAgora) && usarTempoLivre

  const sorted = acoesParaAgora(tasks, {
    contexto: filtro,
    minutosDisponiveis: filtrandoPorTempo ? minutosLivres : null,
  })
  const completed = tasks.filter((t) => t.status === 'completed')

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
          {!done && vaoAgora && onAgendar && (
            <IconButton
              label="Agendar neste vão livre"
              onClick={(e) => { e.stopPropagation(); onAgendar(task, { start: new Date(), end: vaoAgora.end }) }}
            >
              <AgendarIcon />
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
    <div>
      {vaoAgora && (
        <div className="muted" style={{ fontSize: 'var(--label-md)', marginBottom: 8 }}>
          Livre agora até {formatTime(vaoAgora.end)} · {formatDuration(minutosLivres)}
        </div>
      )}

      {contextos.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 10 }}>
        {vaoAgora && (
          <label className="muted" style={{ fontSize: 'var(--label-md)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={usarTempoLivre} onChange={(e) => setUsarTempoLivre(e.target.checked)} />
            Só o que cabe nesse tempo
          </label>
        )}
        <label className="muted" style={{ fontSize: 'var(--label-md)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => onToggleShowCompleted(e.target.checked)}
          />
          Mostrar concluídas
        </label>
      </div>

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
