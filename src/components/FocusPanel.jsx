// O pomodoro como ele aparece dentro do painel do trilho: compacto, com o
// relógio grande e os controles da fase atual. A tela cheia é outro componente.
export default function FocusPanel({ focus }) {
  const { phase, clock, paused, phaseLabel, activeTask } = focus

  return (
    <div>
      <div className="panel-head">
        <span className="muted">{phaseLabel}</span>
        {phase !== 'idle' && (
          <button onClick={focus.openImmersive}>Tela cheia</button>
        )}
      </div>

      <div className="focus-panel-clock">{clock}</div>

      <div className="focus-panel-task">
        {activeTask ? activeTask.title : 'Escolha uma tarefa na lista ao lado'}
      </div>

      <div className="panel-actions">
        {phase === 'idle' ? (
          <button className="primary" onClick={focus.start} disabled={!activeTask}>
            Iniciar 25 min
          </button>
        ) : (
          <>
            {paused ? (
              <button className="primary" onClick={focus.resume}>Retomar</button>
            ) : (
              <button onClick={focus.pause}>Pausar</button>
            )}
            {phase === 'break' && <button onClick={focus.skipBreak}>Pular pausa</button>}
            <button onClick={focus.stop}>Encerrar</button>
          </>
        )}
      </div>
    </div>
  )
}
