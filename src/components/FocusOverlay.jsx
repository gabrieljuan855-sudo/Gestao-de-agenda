import FocusRing from './FocusRing.jsx'

// A tela cheia do foco. Fica fora do trilho de propósito: ela cobre a página
// inteira, então não pode depender de o painel estar aberto.
//
// Continua aberta quando a pausa acaba (fase 'done'), com o próximo bloco a um
// toque: fechar sozinha obrigava a caçar o botão do trilho para emendar.
export default function FocusOverlay({ focus }) {
  const { phase, clock, paused, activeTask, immersive, progress } = focus
  if (!immersive || phase === 'idle') return null

  const titulo = phase === 'focus' ? 'Foco' : phase === 'break' ? 'Pausa' : 'Ciclo concluído'

  return (
    <div className="focus-overlay" role="dialog" aria-label="Modo foco">
      <div className="focus-phase">{titulo}</div>

      <FocusRing
        progress={progress}
        className={`focus-ring--grande focus-ring--${phase}${paused ? ' is-paused' : ''}`}
      >
        <span className="focus-clock">{clock}</span>
      </FocusRing>

      <div className="focus-task">{activeTask ? activeTask.title : ''}</div>

      <div className="focus-actions">
        {phase === 'done' ? (
          <button className="primary" onClick={focus.start} disabled={!activeTask}>
            Novo bloco de 25 min
          </button>
        ) : (
          <>
            {paused ? (
              <button className="primary" onClick={focus.resume}>Retomar</button>
            ) : (
              <button onClick={focus.pause}>Pausar</button>
            )}
            <button onClick={focus.restart}>Reiniciar</button>
            {phase === 'break' && <button onClick={focus.skipBreak}>Pular pausa</button>}
          </>
        )}
        <button onClick={focus.stop}>Encerrar</button>
      </div>

      <button className="focus-exit" onClick={focus.closeImmersive}>
        sair da tela cheia (esc)
      </button>
    </div>
  )
}
