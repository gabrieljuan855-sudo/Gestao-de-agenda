import FocusRing from './FocusRing.jsx'
import Banner from './Banner.jsx'

// O pomodoro como ele aparece dentro do painel do trilho: compacto, com o
// relógio grande e os controles da fase atual. A tela cheia é outro componente.
export default function FocusPanel({ focus, onCompleteTask }) {
  const { phase, clock, paused, phaseLabel, activeTask, progress, notice } = focus

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
