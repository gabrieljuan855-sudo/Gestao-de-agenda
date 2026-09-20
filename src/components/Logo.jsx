// A marca do app: o ícone "brain" da biblioteca Lucide (lucide.dev, licença
// ISC — uso livre, inclusive comercial), na cor de destaque, mesma
// linguagem monocromática dos ícones do trilho (Rail.jsx). Path oficial,
// sem alteração.
//
// Fica inline, e não como <img src="/logo.svg">, para aparecer junto com a
// tela em vez de piscar depois de uma requisição extra.
export default function Logo({ size = 28, title = 'Segundo Cérebro' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="var(--accent)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={title}
    >
      <path d="M12 18V5" />
      <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
      <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
      <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
      <path d="M18 18a4 4 0 0 0 2-7.464" />
      <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
      <path d="M6 18a4 4 0 0 1-2-7.464" />
      <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
    </svg>
  )
}
