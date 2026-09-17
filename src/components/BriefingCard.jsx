// Cartão que aparece ao lado do "Bom dia" nos horários fixos do briefing
// (ver useBriefing.js) — some sozinho depois de 30 minutos, ou ao tocar no
// ✕, sem perder o briefing em si (que continua acessível até o cartão
// sumir).
export default function BriefingCard({ onOpen, onDismiss }) {
  return (
    <button type="button" className="briefing-card" onClick={onOpen}>
      <span>✨ Briefing</span>
      <span
        className="briefing-card-close"
        role="button"
        aria-label="Dispensar"
        onClick={(e) => {
          e.stopPropagation()
          onDismiss()
        }}
      >
        ✕
      </span>
    </button>
  )
}
