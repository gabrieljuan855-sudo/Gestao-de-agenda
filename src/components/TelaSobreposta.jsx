import { useEffect } from 'react'

// Uma tela inteira por cima do app, com o véu atrás — o mesmo formato das
// telas de Projetos e Anotações (as classes são as delas, ver .rail-panel),
// para o que é longo e importante ter o espaço que merece em vez de caber
// numa coluna lateral. No celular vira tela cheia pelo mesmo CSS.
export default function TelaSobreposta({ titulo, onFechar, children, acoes }) {
  useEffect(() => {
    function onKey(e) {
      // Um diálogo aberto por cima (editar uma tarefa) responde ao Esc antes.
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) onFechar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onFechar])

  return (
    <>
      <div className="rail-scrim" onClick={onFechar} aria-hidden="true" />
      <div className="rail-panel card is-wide tela-sobreposta" role="dialog" aria-label={titulo}>
        <div className="rail-panel-head">
          <strong>{titulo}</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {acoes}
            <button type="button" className="rail-close" onClick={onFechar} aria-label="Fechar">×</button>
          </div>
        </div>
        {children}
      </div>
    </>
  )
}
