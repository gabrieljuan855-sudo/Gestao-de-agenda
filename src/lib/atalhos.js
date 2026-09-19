// Atalhos de teclado do app. A parte que decide SE a tecla é nossa mora aqui,
// pura e testável — o hook (useAtalhos.js) só registra o listener e despacha.
//
// Teclas secas, sem modificador, no espírito de Gmail/Linear: com uma mão só,
// sem acorde. O que torna isso seguro é a guarda de campo de texto logo
// abaixo; sem ela, digitar "casa" numa anotação abriria três painéis.
export const ATALHOS = [
  { tecla: 'c', acao: 'criar', descricao: 'Capturar' },
  { tecla: 'e', acao: 'entrada', descricao: 'Entrada (esclarecer)' },
  { tecla: 'n', acao: 'notas', descricao: 'Anotações' },
  { tecla: 'b', acao: 'buscar', descricao: 'Buscar', alias: '/' },
  { tecla: 'p', acao: 'pomodoro', descricao: 'Pomodoro' },
  { tecla: '1', acao: 'vista-dia', descricao: 'Ver o dia' },
  { tecla: '2', acao: 'vista-semana', descricao: 'Ver a semana' },
  { tecla: '3', acao: 'vista-mes', descricao: 'Ver o mês' },
  { tecla: 'h', acao: 'hoje', descricao: 'Voltar para hoje' },
  { tecla: '←', acao: 'anterior', descricao: 'Período anterior' },
  { tecla: '→', acao: 'proximo', descricao: 'Próximo período' },
  { tecla: '?', acao: 'ajuda', descricao: 'Mostrar esta lista' },
]

const POR_TECLA = {
  c: 'criar',
  e: 'entrada',
  n: 'notas',
  b: 'buscar',
  '/': 'buscar',
  p: 'pomodoro',
  1: 'vista-dia',
  2: 'vista-semana',
  3: 'vista-mes',
  h: 'hoje',
  ArrowLeft: 'anterior',
  ArrowRight: 'proximo',
  '?': 'ajuda',
}

// Digitar num campo é digitar, não comandar. Sem esta checagem os atalhos
// seriam inutilizáveis: todo painel do trilho abre com o cursor já dentro de
// um campo (autoFocus), então a primeira letra digitada viraria comando.
function estaDigitando(alvo) {
  if (!alvo) return false
  const tag = alvo.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || alvo.isContentEditable === true
}

// Devolve o nome da ação, ou null quando a tecla não é nossa.
export function atalhoDoEvento(event) {
  if (!event) return null
  // Ctrl/Cmd/Alt são do navegador e do sistema: Ctrl+P tem que continuar
  // imprimindo, Cmd+L indo para a barra de endereço.
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  // Escape não entra aqui de propósito: já existem três listeners tratando
  // dele (Modal, Rail, foco imersivo), e competir fecharia dois de uma vez.
  if (event.key === 'Escape') return null
  if (estaDigitando(event.target)) return null

  const tecla = event.key.length === 1 ? event.key.toLowerCase() : event.key
  return POR_TECLA[tecla] || null
}
