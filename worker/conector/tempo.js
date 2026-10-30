// O fuso das respostas do conector.
//
// O Worker roda em UTC, mas o app pensa em horário de Brasília: o "hoje" de
// uma tarefa atrasada, o expediente das 8h às 17h30 de schedule.js, os vãos
// livres de findFreeGaps. Essas funções de src/lib/ trabalham com o relógio
// local do processo (setHours, getDate) — no navegador, é o relógio da pessoa;
// no Worker, seria o de Greenwich, e "atrasada" viraria três horas antes da
// hora. Em vez de reescrever cada uma com fuso explícito, o conector entrega a
// elas um relógio local que *mostra* a hora de Brasília (relogioLocal) e
// converte o resultado de volta (instanteDoRelogio). As funções do app ficam
// como estão, e continuam sendo as mesmas dos dois lados.

export const FUSO = 'America/Sao_Paulo'

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const DIAS_CURTOS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.']

const formatoPartes = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

// Ano, mês, dia, hora... de um instante, como um relógio em Brasília mostra.
export function partesNoFuso(instante) {
  const p = Object.fromEntries(formatoPartes.formatToParts(instante).map((x) => [x.type, x.value]))
  return { ano: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour, minuto: +p.minute, segundo: +p.second }
}

const pad = (n) => String(n).padStart(2, '0')

export function dataNoFuso(instante) {
  const p = partesNoFuso(instante)
  return `${p.ano}-${pad(p.mes)}-${pad(p.dia)}`
}

export function horaNoFuso(instante) {
  const p = partesNoFuso(instante)
  return `${pad(p.hora)}:${pad(p.minuto)}`
}

// Quanto Brasília está atrás de UTC naquele instante, em ms. Calculado em vez
// de fixo: o Brasil já teve horário de verão, e pode voltar a ter.
function deslocamento(instante) {
  const p = partesNoFuso(instante)
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo)
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000
}

// O instante em que um relógio de Brasília marca aquela data e hora.
export function instanteNoFuso(dataIso, hhmm = '00:00') {
  const [a, m, d] = dataIso.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const palpite = Date.UTC(a, m - 1, d, h, mi)
  // Duas voltas acertam também a hora da troca de horário de verão.
  let instante = new Date(palpite - deslocamento(new Date(palpite)))
  instante = new Date(palpite - deslocamento(instante))
  return instante
}

export function somarDias(dataIso, dias) {
  const [a, m, d] = dataIso.split('-').map(Number)
  const x = new Date(Date.UTC(a, m - 1, d + dias))
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`
}

// Um Date no relógio local do processo que marca a hora de Brasília daquele
// instante — o formato que as funções de src/lib/ esperam (ver o topo).
export function relogioLocal(instante) {
  const p = partesNoFuso(instante)
  return new Date(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo)
}

// O caminho de volta: um Date de relógio local vira o instante real.
export function instanteDoRelogio(local) {
  const data = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`
  return instanteNoFuso(data, `${pad(local.getHours())}:${pad(local.getMinutes())}`)
}

// Um evento com os horários trocados pelo relógio local (ver relogioLocal).
// Dia inteiro não muda: a data já é a data de Brasília.
export function eventoNoRelogioLocal(evento) {
  const trocar = (ponta) =>
    ponta?.dateTime ? { ...ponta, dateTime: relogioLocal(new Date(ponta.dateTime)).toISOString() } : ponta
  return { ...evento, start: trocar(evento.start), end: trocar(evento.end) }
}

function diaDaSemana(dataIso) {
  const [a, m, d] = dataIso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay()
}

// "qui., 30/10/2026" — dia da semana junto, porque é por ele que se pensa a
// semana ("sexta eu faço"), e o modelo erra o dia da semana de uma data solta.
export function dataComDia(dataIso, { ano = true } = {}) {
  const [a, m, d] = dataIso.split('-')
  return `${DIAS_CURTOS[diaDaSemana(dataIso)]} ${d}/${m}${ano ? `/${a}` : ''}`
}

export function nomeDoDia(dataIso) {
  return DIAS[diaDaSemana(dataIso)]
}

// Quantos dias de uma data para outra (as duas AAAA-MM-DD).
export function diasEntre(deIso, ateIso) {
  const [a1, m1, d1] = deIso.split('-').map(Number)
  const [a2, m2, d2] = ateIso.split('-').map(Number)
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000)
}
