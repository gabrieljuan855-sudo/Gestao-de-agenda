// A cor de cada agenda vem do Google e foi escolhida para o fundo branco dele.
// Sobre o cartão escuro do app, o azul e o verde puros gritavam mais alto que
// o próprio conteúdo. A mistura com o cartão é regulada pelo tema
// (--agenda-forca: inteira no claro, mais contida no escuro), então esta
// função não precisa saber em qual tema está.
export function corDaAgenda(cor, reserva = 'var(--accent)') {
  if (typeof cor !== 'string' || !cor.trim()) return reserva
  return `color-mix(in srgb, ${cor} var(--agenda-forca), var(--surface-container))`
}
