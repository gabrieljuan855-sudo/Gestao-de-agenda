// Qual build do app uma página carrega, pelo nome com hash do script
// principal (o Vite troca o hash a cada deploy). É o jeito de a janela aberta
// saber que existe uma versão mais nova publicada: a janela do app no
// computador fica aberta por dias, e o que foi publicado nesse meio tempo
// nunca chegava até ela — a pessoa via o comportamento antigo achando que a
// correção não tinha funcionado.
const SCRIPT_PRINCIPAL = /assets\/index-[\w-]+\.js/

export function extrairVersao(texto) {
  if (typeof texto !== 'string') return null
  return texto.match(SCRIPT_PRINCIPAL)?.[0] || null
}

// Só é "nova" quando as duas são conhecidas e diferentes: sem saber a versão
// atual (ambiente de desenvolvimento) ou a publicada (rede caiu), não se
// incomoda ninguém com aviso.
export function temVersaoNova(atual, publicada) {
  return Boolean(atual && publicada && atual !== publicada)
}
