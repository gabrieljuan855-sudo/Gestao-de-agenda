// A tela cheia do foco. Fica fora do trilho de propósito: ela cobre a página
// inteira, então não pode depender de o painel estar aberto.
export default function FocusOverlay({ focus }) {
  const { phase, clock, paused, activeTask, immersive } = focus
  if (!immersive || phase === 'idle') return null

  return (
    <div className="focus-overlay" role="dialog" aria-label="Modo foco">
      <div className="focus-phase">{phase === 'focus' ? 'Foco' : 'Pausa'}</div>
      <div className="focus-clock">{clock}</div>
      <div className="focus-task">{activeTask ? activeTask.title : ''}</div>

      <div className="focus-actions">
        {paused ? (
          <button className="primary" onClick={focus.resume}>Retomar</button>
        ) : (
          <button onClick={focus.pause}>Pausar</button>
        )}
        {phase === 'break' && <button onClick={focus.skipBreak}>Pular pausa</button>}
        <button onClick={focus.stop}>Encerrar</button>
      </div>

      <button className="focus-exit" onClick={focus.closeImmersive}>
        sair da tela cheia (esc)
      </button>
    </div>
  )
}
