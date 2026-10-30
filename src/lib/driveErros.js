// Como reconhecer, num erro do Google, o que deu errado com o Drive. Separado
// de driveNotes.js porque o conector do Claude (no Worker) também precisa
// dizer com clareza "falta permissão" ou "a API está desligada" — e
// driveNotes.js puxa o login do navegador, que no Worker não existe.

// O 403 que o Drive devolve quando o token não carrega o escopo
// `drive.appdata`. Acontece com quem entrou no app antes de a sincronização
// existir: o refresh token guardado na sessão congela os escopos do dia em
// que foi autorizado, e nenhum access token tirado dele ganha um escopo
// novo. Não adianta tentar de novo — só um login novo resolve, e é isso que
// a tela precisa dizer, em vez de falar em falha passageira.
export function faltaPermissaoDoDrive(err) {
  if (err?.status !== 403) return false
  return /insufficient|ACCESS_TOKEN_SCOPE/i.test(String(err.body || err.message || ''))
}

// O outro 403 possível, e que não tem nada a ver com login: a API do Drive
// não está ativada no projeto do Google Cloud. O escopo pode estar concedido
// e o token perfeito — a chamada é recusada antes de chegar aos dados, porque
// o projeto nunca habilitou essa API. Calendar e Tasks funcionarem não diz
// nada sobre o Drive: cada API é ativada separadamente, e esta é a primeira
// vez que o app chama o Drive. Nenhum login novo resolve; só o console.
export function driveApiDesativada(err) {
  if (err?.status !== 403) return false
  return /accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(
    String(err.body || err.message || '')
  )
}

// A frase que o próprio Google escreveu para o erro. Sem ela, "erro 403" vira
// um beco sem saída: o código sozinho não distingue API desligada de cota
// estourada, e foi justamente essa ambiguidade que arrastou o diagnóstico.
export function motivoDoGoogle(err) {
  try {
    return JSON.parse(err?.body || '')?.error?.message || ''
  } catch {
    return ''
  }
}
