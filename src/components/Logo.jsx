// A marca do app: a folha da agenda (com as argolas), o anel do pomodoro em
// três quartos — os Google colors marcando o tempo corrido, o cinza o que
// falta — e o certo verde da tarefa concluída no centro.
//
// Fica inline, e não como <img src="/logo.svg">, para aparecer junto com a
// tela em vez de piscar depois de uma requisição extra. Por estar inline (e
// não num arquivo .svg à parte, que não vê CSS nenhum da página), a folha e
// as partes neutras usam as variáveis de tema: no escuro o papel branco
// ficaria um retângulo aceso no meio da tela. As quatro cores da marca do
// Google (azul, vermelho, amarelo, verde) continuam fixas nos dois temas —
// são a identidade, não decoração.
export default function Logo({ size = 28, title = 'Gestão de Agenda' }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} role="img" aria-label={title}>
      <rect x="13.5" y="3" width="6" height="10" rx="3" style={{ fill: 'var(--logo-mark)' }} />
      <rect x="28.5" y="3" width="6" height="10" rx="3" style={{ fill: 'var(--logo-mark)' }} />
      <rect
        x="5" y="9" width="38" height="36" rx="8"
        style={{ fill: 'var(--surface-1)', stroke: 'var(--border-strong)' }}
        strokeWidth="2"
      />
      <g fill="none" strokeWidth="5.2" strokeLinecap="round">
        <path d="M11.5 27.5 A 12.5 12.5 0 0 1 24 15" style={{ stroke: 'var(--logo-track)' }} />
        <path d="M24 15 A 12.5 12.5 0 0 1 36.5 27.5" stroke="#4285F4" />
        <path d="M36.5 27.5 A 12.5 12.5 0 0 1 24 40" stroke="#EA4335" />
        <path d="M24 40 A 12.5 12.5 0 0 1 11.5 27.5" stroke="#FBBC04" />
      </g>
      <path
        d="M18.4 27.8 L 22.4 31.8 L 30 23.4"
        fill="none"
        stroke="#34A853"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
