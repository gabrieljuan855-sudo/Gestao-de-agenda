// Atalhos de teclado do app. A parte que decide SE a tecla é nossa mora aqui,
// pura e testável — o hook (useAtalhos.js) só registra o listener e despacha.
//
// Começar a digitar em qualquer lugar abre a captura com o que foi digitado:
// é o jeito mais curto de tirar uma coisa da cabeça, sem procurar botão. Por
// isso as letras e os números soltos são da captura, e os atalhos dos painéis
// usam Alt (Option no Mac). Ficam sem Alt só as teclas que ninguém usa para
// começar uma frase: as setas, "/" (buscar) e "?" (esta lista).
export const ATALHOS = [
  { tecla: 'c', alt: true, acao: 'criar', descricao: 'Capturar (ou só comece a digitar)' },
  { tecla: 'e', alt: true, acao: 'entrada', descricao: 'Entrada (esclarecer)' },
  { tecla: 't', alt: true, acao: 'proximas', descricao: 'Próximas ações' },
  { tecla: 'p', alt: true, acao: 'projetos', descricao: 'Projetos' },
  { tecla: 'a', alt: true, acao: 'aguardando', descricao: 'Aguardando' },
  { tecla: 'r', alt: true, acao: 'revisao', descricao: 'Revisão da semana' },
  { tecla: 'n', alt: true, acao: 'notas', descricao: 'Anotações' },
  { tecla: 'b', alt: true, acao: 'buscar', descricao: 'Buscar', alias: '/' },
  { tecla: '1', alt: true, acao: 'vista-dia', descricao: 'Ver o dia' },
  { tecla: '2', alt: true, acao: 'vista-semana', descricao: 'Ver a semana' },
  { tecla: '3', alt: true, acao: 'vista-mes', descricao: 'Ver o mês' },
  { tecla: '4', alt: true, acao: 'vista-lista', descricao: 'Ver a lista do que vem por aí' },
  { tecla: 'h', alt: true, acao: 'hoje', descricao: 'Voltar para hoje' },
  { tecla: '←', acao: 'anterior', descricao: 'Período anterior' },
  { tecla: '→', acao: 'proximo', descricao: 'Próximo período' },
  { tecla: '?', acao: 'ajuda', descricao: 'Mostrar esta lista' },
]

// Com Alt, pela tecla física (event.code): no Mac, Option+C escreve "ç" no
// event.key, e o atalho tem que continuar sendo C.
const COM_ALT = Object.fromEntries(ATALHOS.filter((a) => a.alt).map((a) => [/\d/.test(a.tecla) ? `Digit${a.tecla}` : `Key${a.tecla.toUpperCase()}`, a.acao]))

const SEM_ALT = {
  '/': 'buscar',
  '?': 'ajuda',
  ArrowLeft: 'anterior',
  ArrowRight: 'proximo',
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
  // Ctrl/Cmd são do navegador e do sistema: Ctrl+P tem que continuar
  // imprimindo, Cmd+L indo para a barra de endereço.
  if (event.ctrlKey || event.metaKey) return null
  // Escape não entra aqui de propósito: já existem três listeners tratando
  // dele (Modal, Rail, foco imersivo), e competir fecharia dois de uma vez.
  if (event.key === 'Escape') return null
  if (estaDigitando(event.target)) return null
  if (event.altKey) return COM_ALT[event.code] || null
  return SEM_ALT[event.key] || null
}

// A tecla que começa uma captura: um caractere de texto, fora de um campo,
// sem modificador, e que não seja atalho. Devolve o caractere, ou null.
export function textoParaCapturar(event) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null
  if (estaDigitando(event.target)) return null
  if (typeof event.key !== 'string' || event.key.length !== 1 || event.key === ' ') return null
  if (SEM_ALT[event.key]) return null
  return event.key
}
