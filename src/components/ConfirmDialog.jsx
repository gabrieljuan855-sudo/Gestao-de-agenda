import Modal from './Modal.jsx'

// Confirmação de uma ação irreversível ou importante, no padrão visual do
// resto do app — no lugar do `window.confirm` nativo, que aparece com a cara
// do sistema operacional (sem o tema claro/escuro, sem cantos arredondados) e
// destoa ainda mais quando surge por cima de um modal já aberto.
export default function ConfirmDialog({
  title = 'Confirmar',
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal title={title} onClose={onCancel} elevated>
      <p style={{ margin: 0 }}>{message}</p>
      <div className="modal-actions" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onCancel}>{cancelLabel}</button>
        <button className={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
