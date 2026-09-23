// Vocabulário de repetição do editor de compromisso — as opções mais comuns
// da Agenda do Google, sem virar um construtor de RRULE genérico (o Google
// aceita regras bem mais elaboradas, mas cobrir todas exigiria uma tela à
// parte para algo que quase ninguém usa).
export const REPETICOES = [
  { id: 'nunca', label: 'Não repete' },
  { id: 'diaria', label: 'Todo dia' },
  { id: 'semanal', label: 'Toda semana' },
  { id: 'mensal', label: 'Todo mês (mesmo dia)' },
  { id: 'anual', label: 'Todo ano' },
]

// Só entra na lista quando o compromisso já tem uma regra que as opções
// acima não sabem reproduzir (feita direto na Agenda do Google, ou com
// INTERVAL/COUNT/UNTIL) — ver reconhecerRecorrencia. Trocar para outra opção
// substitui a regra; deixar como está preserva a personalizada.
export const REPETICAO_PERSONALIZADA = { id: 'personalizada', label: 'Personalizada (feita na Agenda do Google)' }

const DIAS_RRULE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

// Constrói a regra de repetição a partir da opção escolhida e da data do
// próprio compromisso — a semanal usa o dia da semana dele, a mensal o dia
// do mês, sem pedir de novo o que o compromisso já diz sozinho.
export function construirRecorrencia(id, dataReferencia) {
  if (id === 'diaria') return ['RRULE:FREQ=DAILY']
  if (id === 'semanal') return [`RRULE:FREQ=WEEKLY;BYDAY=${DIAS_RRULE[dataReferencia.getDay()]}`]
  if (id === 'mensal') return [`RRULE:FREQ=MONTHLY;BYMONTHDAY=${dataReferencia.getDate()}`]
  if (id === 'anual') return ['RRULE:FREQ=YEARLY']
  return []
}

// O caminho inverso: reconhece uma das quatro regras simples para o seletor
// abrir já marcado na opção certa. Uma regra com INTERVAL/COUNT/UNTIL (ou
// mais de uma linha de RRULE) não tem opção equivalente aqui — vira
// "personalizada", e fica só de leitura até a pessoa trocar de propósito.
export function reconhecerRecorrencia(recurrence) {
  if (!recurrence || recurrence.length === 0) return 'nunca'
  if (recurrence.length > 1) return 'personalizada'
  const regra = recurrence[0]
  if (!regra || !regra.startsWith('RRULE:')) return 'personalizada'
  if (/[;:](INTERVAL|COUNT|UNTIL)=/.test(regra)) return 'personalizada'
  if (/FREQ=DAILY$/.test(regra)) return 'diaria'
  if (/^RRULE:FREQ=WEEKLY;BYDAY=[A-Z]{2}$/.test(regra)) return 'semanal'
  if (/^RRULE:FREQ=MONTHLY;BYMONTHDAY=\d{1,2}$/.test(regra)) return 'mensal'
  if (/FREQ=YEARLY$/.test(regra)) return 'anual'
  return 'personalizada'
}

// Frases comuns de repetição escritas na captura ("reunião toda segunda
// 14h", "pagar o boleto todo mês") — reconhecidas antes de chegar ao
// chrono-node, porque "toda segunda" sozinho não é uma data, é uma regra.
const PADROES = [
  { re: /\btod[oa]s?\s+os?\s+dias?\b|\bdiariamente\b/iu, id: 'diaria' },
  { re: /\btod[oa]\s+(semana|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(-feira)?\b|\bsemanalmente\b/iu, id: 'semanal' },
  { re: /\btodo\s+m[êe]s\b|\bmensalmente\b/iu, id: 'mensal' },
  { re: /\btodo\s+ano\b|\banualmente\b/iu, id: 'anual' },
]

export function detectarRecorrencia(texto) {
  const encontrado = PADROES.find(({ re }) => re.test(texto))
  return encontrado ? encontrado.id : null
}
