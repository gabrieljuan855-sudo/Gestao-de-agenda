// A marca do app: um cérebro visto de frente, silhueta cheia com os sulcos
// (as dobras) recortados por dentro — o desenho clássico de ícone de
// cérebro, não um contorno decorativo. Fica num chip com fundo próprio (o
// mesmo token --surface-1 em qualquer lugar do app), porque o recorte dos
// sulcos precisa combinar exatamente com o que está atrás — e o Logo aparece
// tanto sobre --surface (o fundo da página, no cabeçalho) quanto sobre
// --surface-1 (o card de login), que não são o mesmo tom.
//
// Um hemisfério é desenhado uma vez (HEMISFERIO/SULCOS) e espelhado com
// `scale(-1,1)` para o outro lado — os dois lados são idênticos e simétricos
// de propósito, como um cérebro visto de frente de verdade.
//
// Fica inline, e não como <img src="/logo.svg">, para aparecer junto com a
// tela em vez de piscar depois de uma requisição extra.
const HEMISFERIO = [
  { cx: 31, cy: 10.5, r: 6 },
  { cx: 37.5, cy: 15.5, r: 6 },
  { cx: 39.5, cy: 23, r: 6.2 },
  { cx: 36.5, cy: 30.5, r: 6 },
  { cx: 29, cy: 34.5, r: 6.5 },
  { cx: 25.5, cy: 20, r: 7.5 },
  { cx: 24.5, cy: 29, r: 6.5 },
]

// Curvas longas e contínuas em zigue-zague — é isso que faz ler como dobra
// de cérebro; curvas curtas em espiral liam como orelha ou "@".
const SULCOS = [
  'M26.5 9 C 30 12 27 16 30.5 19 C 34 22 31 26 34.5 29 C 37 31 36 33.5 34 35',
  'M33 8.5 C 36.5 11.5 34 15 37 18 C 39.5 20.5 38 24 40 27',
  'M22 19 C 24.5 21.5 22.5 24.5 25 27 C 26.8 28.8 26 31.5 27.5 33.5',
]

function Hemisferio({ mirror = false }) {
  return (
    <g transform={mirror ? 'translate(48,0) scale(-1,1)' : undefined}>
      {HEMISFERIO.map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r={c.r} fill="var(--accent)" />
      ))}
      {SULCOS.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--surface-1)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </g>
  )
}

export default function Logo({ size = 28, title = 'Segundo Cérebro' }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} role="img" aria-label={title}>
      <rect x="0" y="0" width="48" height="48" rx="11" fill="var(--surface-1)" />
      <Hemisferio />
      <Hemisferio mirror />
      <path d="M24 9 L24 15" stroke="var(--surface-1)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}
