import { useEffect } from 'react'

// `elevated` é para um diálogo aberto por cima de outro (a confirmação de
// excluir, aberta de dentro do modal de editar): sem subir o z-index, os dois
// ficam na mesma camada e o de baixo pode vazar por cima do de cima,
// dependendo da ordem em que o React montou os dois.
export default function Modal({ title, onClose, children, elevated = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" style={elevated ? { zIndex: 60 } : undefined} onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head">
          <strong style={{ fontSize: 'var(--body-lg)' }}>{title}</strong>
          <button onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
