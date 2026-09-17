// Aviso de página/seção no padrão de "banner" do Material Design 3: ícone +
// texto + no máximo uma ação, em vez de um texto colorido solto. Serve para
// os avisos que ficam na tela até o usuário agir ou a causa deles sumir —
// diferente do texto de erro de um campo, que continua simples (é curto e
// já está colado no campo que errou).
export default function Banner({ tone = 'error', children, actionLabel, onAction }) {
  return (
    <div className={`banner banner--${tone}`} role="status">
      <span className="banner-icon" aria-hidden="true">⚠</span>
      <div className="banner-text">{children}</div>
      {actionLabel && onAction && (
        <button onClick={onAction} style={{ flexShrink: 0 }}>{actionLabel}</button>
      )}
    </div>
  )
}
