import { useState } from 'react'
import { acoesParaAgora } from '../lib/agora.js'
import { findFreeGaps } from '../lib/events.js'
import { workBlocksFor } from '../lib/schedule.js'
import { formatTime, formatDuration } from '../lib/dates.js'
import { PRIORITY_LABEL } from '../lib/priority.js'
import HorarioTrabalho from './HorarioTrabalho.jsx'

// A pergunta clássica de engajamento do GTD: dado onde estou e quanto tempo
// tenho, qual é a melhor próxima ação disponível agora? O Backlog mostra a
// lista inteira porque é o material bruto da decisão; esta tela já decide.
export default function Agora({ tasks, events, occupies = () => true, schedule, onSchedule, onFocus, onAgendar }) {
  const [filtroContexto, setFiltroContexto] = useState(null)
  const [usarTempoLivre, setUsarTempoLivre] = useState(true)
  const [editandoHorario, setEditandoHorario] = useState(false)

  const agora = new Date()
  const gaps = findFreeGaps(events, agora, workBlocksFor(agora, schedule), { occupies })
  // O vão livre que interessa é o de agora, e sem ele o próximo que vier —
  // fora do expediente ou entre dois compromissos, ainda faz sentido dizer
  // "daqui a pouco você tem uma folga de tanto tempo".
  const vaoAtual = gaps.find((g) => g.start <= agora && g.end > agora) || gaps.find((g) => g.start > agora) || null
  const comecaAgora = Boolean(vaoAtual) && vaoAtual.start <= agora
  const minutosLivres = vaoAtual
    ? Math.round((vaoAtual.end - (comecaAgora ? agora : vaoAtual.start)) / 60000)
    : null

  const contextos = [...new Set((tasks || []).map((t) => t.contexto).filter(Boolean))].sort()

  const candidatas = acoesParaAgora(tasks, {
    contexto: filtroContexto,
    minutosDisponiveis: usarTempoLivre ? minutosLivres : null,
  })

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="muted">Agora</div>
        <button type="button" onClick={() => setEditandoHorario(true)}>Horário de trabalho</button>
      </div>

      {vaoAtual ? (
        <div className="muted" style={{ marginBottom: 10 }}>
          {comecaAgora ? 'Livre agora' : `Próxima folga às ${formatTime(vaoAtual.start)}`} · {formatDuration(minutosLivres)}
        </div>
      ) : (
        <div className="muted" style={{ marginBottom: 10 }}>Sem vão livre hoje, dentro do horário de trabalho.</div>
      )}

      {contextos.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {contextos.map((c) => (
            <button
              key={c}
              type="button"
              className={`pill-filtro${filtroContexto === c ? ' is-escolhido' : ''}`}
              onClick={() => setFiltroContexto((atual) => (atual === c ? null : c))}
            >
              @{c}
            </button>
          ))}
        </div>
      )}

      <label
        className="muted"
        style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, fontSize: 'var(--label-md)' }}
      >
        <input
          type="checkbox"
          checked={usarTempoLivre}
          onChange={(e) => setUsarTempoLivre(e.target.checked)}
          disabled={!vaoAtual}
        />
        Só o que cabe no tempo que tenho agora
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {candidatas.length === 0 && (
          <div className="muted">Nada cabe agora — talvez seja hora de esclarecer a Entrada.</div>
        )}
        {candidatas.map((task) => (
          <div
            key={task.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '8px 12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 'var(--body-md)' }}>{task.title}</div>
              <span className={`pill ${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
              {task.contexto && (
                <span className="muted" style={{ marginLeft: 8, fontSize: 'var(--label-sm)' }}>@{task.contexto}</span>
              )}
              {task.duracao && (
                <span className="muted" style={{ marginLeft: 8, fontSize: 'var(--label-sm)' }}>~{task.duracao}min</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {onFocus && <button type="button" onClick={() => onFocus(task)}>Focar</button>}
              {comecaAgora && onAgendar && (
                <button type="button" onClick={() => onAgendar(task, { start: new Date(), end: vaoAtual.end })}>
                  Agendar aqui
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {editandoHorario && (
        <HorarioTrabalho schedule={schedule} onChange={onSchedule} onClose={() => setEditandoHorario(false)} />
      )}
    </div>
  )
}
