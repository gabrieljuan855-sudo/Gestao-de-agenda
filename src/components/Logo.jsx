// A marca do app: um cérebro em traço único, na cor de destaque — a mesma
// linguagem monocromática dos ícones do trilho (Rail.jsx), em vez de uma
// segunda paleta só para a marca. As dobras (gyri) na borda são o que
// distingue isso de uma bolha lisa qualquer: sem elas a forma lê como um
// coração ou um escudo, não como um cérebro.
//
// Fica inline, e não como <img src="/logo.svg">, para aparecer junto com a
// tela em vez de piscar depois de uma requisição extra.
const LOBO =
  'M23 7' +
  ' C 20 5.7 16.3 6.2 14.2 8.4' +
  ' C 11.3 7.5 8.4 9.2 7.7 12' +
  ' C 5.2 12.5 3.6 15 4.1 17.5' +
  ' C 2 18.7 1.2 21.5 2.5 23.7' +
  ' C 0.9 25.6 1.1 28.5 3 30.1' +
  ' C 2.2 32.6 3.5 35.3 6 36.2' +
  ' C 6.1 38.8 8.3 40.9 11 40.7' +
  ' C 12.2 43 14.8 44.2 17.3 43.3' +
  ' C 18.7 44.5 20.7 44.8 22.4 44' +
  ' C 22.7 43.85 23 43.6 23 43.2' +
  ' Z'

export default function Logo({ size = 28, title = 'Segundo Cérebro' }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} role="img" aria-label={title}>
      <path d={LOBO} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <path
        d={LOBO}
        transform="translate(48,0) scale(-1,1)"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M23.5 6.5 L23.5 43.2" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" opacity="0.45" />
    </svg>
  )
}
