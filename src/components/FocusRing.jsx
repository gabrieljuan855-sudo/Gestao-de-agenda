// O anel de progresso do pomodoro. Desenha o tempo que ainda falta, não o que
// já passou: o arco encolhe, que é como a pessoa pensa o tempo restante.
//
// O SVG tem viewBox fixo e tamanho dado pelo CSS, então o mesmo componente
// serve ao anel pequeno do painel e ao grande da tela cheia, sem prop de
// tamanho nem cálculo em JavaScript a cada quarto de segundo.
const RAIO = 45
const VOLTA = 2 * Math.PI * RAIO

export default function FocusRing({ progress = 0, className = '', children }) {
  const percorrido = Math.min(1, Math.max(0, progress))

  return (
    <div className={`focus-ring ${className}`.trim()}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="focus-ring-track" cx="50" cy="50" r={RAIO} fill="none" />
        <circle
          className="focus-ring-arc"
          cx="50"
          cy="50"
          r={RAIO}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={VOLTA}
          strokeDashoffset={VOLTA * percorrido}
          /* Começa no topo, e não às 3 horas, que é onde o SVG começa. */
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="focus-ring-center">{children}</div>
    </div>
  )
}
