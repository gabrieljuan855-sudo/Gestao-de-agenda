// Sem acento, sem caixa: "dienifer" acha "Dienifer", "audiencia" acha
// "Audiência" e vice-versa. Ninguém para pra lembrar do acento certo achando
// uma coisa rápido — e no teclado do celular o acento é um toque a mais.
export function semAcento(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}
