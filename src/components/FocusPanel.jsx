import FocusRing from './FocusRing.jsx'
import Banner from './Banner.jsx'
import { findFreeGaps } from '../lib/events.js'
import { workBlocksFor } from '../lib/schedule.js'
import { formatTime, formatDuration } from '../lib/dates.js'

// Só o vão que ainda cabe hoje — sugerir um horário que já passou não ajuda
// ninguém a decidir quando focar.
function proximoVaoLivre(events, occupies) {
  const now = new Date()
  const gaps = findFreeGaps(events, now, workBlocksFor(now), { occupies })
  return gaps.find((g) => g.end > now) || null
}

// O pomodoro como ele aparece dentro do painel do trilho: compacto, com o
// relógio grande e os controles da fase atual. A tela cheia é outro componente.
export default function FocusPanel({ focus, onCompleteTask, events = [], occupies = () => true }) {
  const { phase, clock, paused, phaseLabel, activeTask, progress, notice } = focus
  const vaoLivre = phase === 'idle' ? proximoVaoLivre(events, occupies) : null

  return (
    <div>
      <div className="panel-head">
        <span className="muted">{phaseLabel}</span>
        {phase !== 'idle' && <button onClick={focus.openImmersive}>Tela cheia</button>}
      </div>

      {notice && (
        <Banner tone="warning" actionLabel="✕" onAction={focus.dismissNotice}>
          {notice}
        </Banner>
      )}

      <FocusRing progress={progress} className={`focus-ring--${phase}${paused ? ' is-paused' : ''}`}>
        <span className="focus-panel-clock">{clock}</span>
      </FocusRing>

      <div className="focus-panel-task">
        {activeTask ? activeTask.title : 'Escolha uma tarefa na lista ao lado'}
      </div>

      {vaoLivre && (
        <div className="muted" style={{ fontSize: 'var(--label-sm)', marginTop: 2 }}>
          Próximo vão livre: {formatTime(vaoLivre.start)}–{formatTime(vaoLivre.end)} (
          {formatDuration((vaoLivre.end - vaoLivre.start) / 60000)})
        </div>
      )}

      <div className="panel-actions">
        {(phase === 'idle' || phase === 'done') && (
          <button className="primary" onClick={() => focus.start()} disabled={!activeTask}>
            {phase === 'done' ? 'Novo bloco de 25 min' : 'Iniciar 25 min'}
          </button>
        )}

        {/* Atalho, não automatismo: o pomodoro continua sem concluir tarefa
            sozinho. A tela já está olhando para a tarefa quando o ciclo
            termina, então oferece o botão em vez de fazer você caçá-lo. */}
        {phase === 'done' && activeTask && onCompleteTask && (
          <button onClick={() => onCompleteTask(activeTask)}>Marcar tarefa como concluída</button>
        )}

        {(phase === 'focus' || phase === 'break') && (
          <>
            {paused ? (
              <button className="primary" onClick={focus.resume}>Retomar</button>
            ) : (
              <button onClick={focus.pause}>Pausar</button>
            )}
            {/* Recomeça a fase do zero — 25 min viram 25 min de novo. */}
            <button onClick={focus.restart}>Reiniciar</button>
            {phase === 'break' && <button onClick={focus.skipBreak}>Pular pausa</button>}
          </>
        )}

        {phase !== 'idle' && <button onClick={focus.stop}>Encerrar</button>}
      </div>
    </div>
  )
}
