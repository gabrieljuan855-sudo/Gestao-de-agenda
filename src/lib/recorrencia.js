import { toDateInput, fromInputs, endOfDay, addDays } from './dates.js'

// Repetição de compromisso no mesmo vocabulário da Agenda do Google: as
// opções rápidas do seletor ("Semanal: cada quinta-feira", "Mensal na quarta
// quinta-feira", "Todos os dias úteis"...) e o "Personalizar", com intervalo,
// dias da semana e término. Antes o app só conhecia quatro regras fixas, e
// qualquer outra feita no Google virava uma caixa preta só de leitura.

// Os ids simples continuam valendo para a captura em texto ("toda segunda",
// "todo mês"), que só precisa do básico — ver detectarRecorrencia.
export const REPETICOES = [
  { id: 'nunca', label: 'Não repete' },
  { id: 'diaria', label: 'Todo dia' },
  { id: 'semanal', label: 'Toda semana' },
  { id: 'mensal', label: 'Todo mês (mesmo dia)' },
  { id: 'anual', label: 'Todo ano' },
]

const DIAS_RRULE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
export const DIAS_DA_SEMANA = [
  { codigo: 'SU', curto: 'D', nome: 'domingo' },
  { codigo: 'MO', curto: 'S', nome: 'segunda-feira' },
  { codigo: 'TU', curto: 'T', nome: 'terça-feira' },
  { codigo: 'WE', curto: 'Q', nome: 'quarta-feira' },
  { codigo: 'TH', curto: 'Q', nome: 'quinta-feira' },
  { codigo: 'FR', curto: 'S', nome: 'sexta-feira' },
  { codigo: 'SA', curto: 'S', nome: 'sábado' },
]
const DIAS_UTEIS = ['MO', 'TU', 'WE', 'TH', 'FR']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function codigoDoDia(data) {
  return DIAS_RRULE[data.getDay()]
}

function nomeDoDia(codigo) {
  return DIAS_DA_SEMANA.find((d) => d.codigo === codigo)?.nome || codigo
}

// "A quarta quinta-feira do mês": qual ocorrência daquele dia da semana a
// data é. A quinta ocorrência não existe em todo mês, por isso vira "a
// última" — é o mesmo que o Google faz.
export function ordinalNoMes(data) {
  const n = Math.ceil(data.getDate() / 7)
  return n >= 5 ? -1 : n
}

function ehUltimaDoMes(data) {
  return addDays(data, 7).getMonth() !== data.getMonth()
}

// ---------- regra <-> RRULE ----------

// A regra que o editor manipula. `fim` segue as três escolhas do Google:
// nunca, numa data, ou depois de N vezes.
function regraBase(freq, extra = {}) {
  return { freq, intervalo: 1, fim: { tipo: 'nunca' }, ...extra }
}

function lerUntil(valor) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(valor || '')
  if (!m) return null
  const [, a, me, d, h, mi, s, z] = m
  if (!h) return `${a}-${me}-${d}`
  const data = z
    ? new Date(Date.UTC(+a, +me - 1, +d, +h, +mi, +s))
    : new Date(+a, +me - 1, +d, +h, +mi, +s)
  return toDateInput(data)
}

// Lê o `recurrence` do Google. Devolve a regra (ou null, se não repete), as
// linhas que não são RRULE (EXDATE/RDATE — preservadas como vieram) e se o
// editor sabe mexer nela. Uma regra que o editor não sabe reproduzir (vários
// RRULE, BYSETPOS, por hora...) continua valendo: só não é editável aqui.
export function lerRecorrencia(recurrence, dataRef) {
  const linhas = Array.isArray(recurrence) ? recurrence : []
  const rrules = linhas.filter((l) => l.startsWith('RRULE:'))
  const extras = linhas.filter((l) => !l.startsWith('RRULE:'))
  if (rrules.length === 0) return { regra: null, extras, suportada: extras.length === 0 }
  if (rrules.length > 1) return { regra: null, extras, suportada: false }

  const partes = Object.fromEntries(
    rrules[0].slice(6).split(';').filter(Boolean).map((p) => {
      const [k, v = ''] = p.split('=')
      return [k.toUpperCase(), v.toUpperCase()]
    })
  )
  const naoSuportada = { regra: null, extras, suportada: false }
  const conhecidas = ['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'COUNT', 'UNTIL', 'WKST']
  if (Object.keys(partes).some((k) => !conhecidas.includes(k))) return naoSuportada
  if (partes.COUNT && partes.UNTIL) return naoSuportada

  const intervalo = partes.INTERVAL ? Number(partes.INTERVAL) : 1
  if (!Number.isInteger(intervalo) || intervalo < 1) return naoSuportada

  let fim = { tipo: 'nunca' }
  if (partes.COUNT) {
    const vezes = Number(partes.COUNT)
    if (!Number.isInteger(vezes) || vezes < 1) return naoSuportada
    fim = { tipo: 'vezes', vezes }
  } else if (partes.UNTIL) {
    const data = lerUntil(partes.UNTIL)
    if (!data) return naoSuportada
    fim = { tipo: 'data', data }
  }

  const base = { intervalo, fim }
  const dias = partes.BYDAY ? partes.BYDAY.split(',') : []

  if (partes.FREQ === 'DAILY' || partes.FREQ === 'YEARLY') {
    if (dias.length || partes.BYMONTHDAY) return naoSuportada
    return { regra: { freq: partes.FREQ, ...base }, extras, suportada: true }
  }

  if (partes.FREQ === 'WEEKLY') {
    if (partes.BYMONTHDAY || dias.some((d) => !DIAS_RRULE.includes(d))) return naoSuportada
    const lista = dias.length ? DIAS_RRULE.filter((d) => dias.includes(d)) : [codigoDoDia(dataRef)]
    return { regra: { freq: 'WEEKLY', ...base, dias: lista }, extras, suportada: true }
  }

  if (partes.FREQ === 'MONTHLY') {
    if (partes.BYMONTHDAY && dias.length) return naoSuportada
    if (dias.length) {
      const m = dias.length === 1 && /^(-1|[1-4])(SU|MO|TU|WE|TH|FR|SA)$/.exec(dias[0])
      if (!m) return naoSuportada
      return { regra: { freq: 'MONTHLY', ...base, ordinal: Number(m[1]), diaDaSemana: m[2] }, extras, suportada: true }
    }
    const diaDoMes = partes.BYMONTHDAY ? Number(partes.BYMONTHDAY) : dataRef.getDate()
    if (!Number.isInteger(diaDoMes) || diaDoMes < 1 || diaDoMes > 31) return naoSuportada
    return { regra: { freq: 'MONTHLY', ...base, diaDoMes }, extras, suportada: true }
  }

  return naoSuportada
}

function formatarUntil(dataISO, allDay) {
  if (allDay) return dataISO.replace(/-/g, '')
  // Em evento com hora, o Google quer o UNTIL em UTC. O fim do dia escolhido
  // inclui a ocorrência daquele dia, que é o que "termina em" quer dizer.
  return endOfDay(fromInputs(dataISO)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function montarRRule(regra, allDay = false) {
  const partes = [`FREQ=${regra.freq}`]
  if (regra.intervalo > 1) partes.push(`INTERVAL=${regra.intervalo}`)
  if (regra.freq === 'WEEKLY') partes.push(`BYDAY=${regra.dias.join(',')}`)
  if (regra.freq === 'MONTHLY') {
    partes.push(regra.diaDaSemana ? `BYDAY=${regra.ordinal}${regra.diaDaSemana}` : `BYMONTHDAY=${regra.diaDoMes}`)
  }
  if (regra.fim?.tipo === 'vezes') partes.push(`COUNT=${regra.fim.vezes}`)
  if (regra.fim?.tipo === 'data' && regra.fim.data) partes.push(`UNTIL=${formatarUntil(regra.fim.data, allDay)}`)
  return `RRULE:${partes.join(';')}`
}

// O `recurrence` que vai para o Google. Sem regra, não repete — e aí as
// exceções (EXDATE) também deixam de fazer sentido.
export function montarRecorrencia(regra, extras = [], allDay = false) {
  if (!regra) return []
  return [montarRRule(regra, allDay), ...extras]
}

// ---------- opções do seletor ----------

export function regraDaOpcao(id, data) {
  if (id === 'diaria') return regraBase('DAILY')
  if (id === 'semanal') return regraBase('WEEKLY', { dias: [codigoDoDia(data)] })
  if (id === 'dias-uteis') return regraBase('WEEKLY', { dias: [...DIAS_UTEIS] })
  if (id === 'mensal') return regraBase('MONTHLY', { diaDoMes: data.getDate() })
  if (id === 'mensal-semana') return regraBase('MONTHLY', { ordinal: ordinalNoMes(data), diaDaSemana: codigoDoDia(data) })
  if (id === 'anual') return regraBase('YEARLY')
  return null
}

// Mantido para a captura em texto, que monta direto o `recurrence`.
export function construirRecorrencia(id, dataReferencia) {
  const regra = regraDaOpcao(id, dataReferencia)
  return regra ? [montarRRule(regra)] : []
}

const ORDINAIS_F = { 1: 'primeira', 2: 'segunda', 3: 'terceira', 4: 'quarta', '-1': 'última' }
const ORDINAIS_M = { 1: 'primeiro', 2: 'segundo', 3: 'terceiro', 4: 'quarto', '-1': 'último' }

// "na quarta quinta-feira", mas "no último sábado": sábado e domingo são
// masculinos, e o Google erra isso com um "no(a)" que aqui não precisa.
function ordinalPorExtenso(ordinal, codigo) {
  const masculino = codigo === 'SA' || codigo === 'SU'
  const o = (masculino ? ORDINAIS_M : ORDINAIS_F)[ordinal]
  return `${masculino ? 'no' : 'na'} ${o} ${nomeDoDia(codigo)}`
}

export function opcoesDeRepeticao(data) {
  const codigo = codigoDoDia(data)
  return [
    { id: 'nunca', label: 'Não se repete' },
    { id: 'diaria', label: 'Todos os dias' },
    { id: 'semanal', label: `Semanal: cada ${nomeDoDia(codigo)}` },
    { id: 'mensal', label: `Mensal: no dia ${data.getDate()}` },
    { id: 'mensal-semana', label: `Mensal: ${ordinalPorExtenso(ordinalNoMes(data), codigo)}` },
    { id: 'anual', label: `Anual: em ${data.getDate()} de ${MESES[data.getMonth()]}` },
    { id: 'dias-uteis', label: 'Todos os dias úteis (segunda a sexta-feira)' },
  ]
}

// Qual opção rápida a regra é — ou "personalizada", quando ela tem
// intervalo, término ou dias que nenhuma opção rápida tem.
export function opcaoDaRegra(regra, data) {
  if (!regra) return 'nunca'
  const alvo = montarRRule(regra)
  const opcao = opcoesDeRepeticao(data).find((o) => {
    const r = regraDaOpcao(o.id, data)
    return r && montarRRule(r) === alvo
  })
  return opcao ? opcao.id : 'personalizada'
}

// As formas de repetir por mês que fazem sentido para a data: "no dia 22" e
// "na quarta quinta-feira" — e também "na última", quando a data é a última
// daquele dia da semana no mês (dia 25 de um mês de 31 é as duas coisas).
export function opcoesMensais(data) {
  const codigo = codigoDoDia(data)
  const n = ordinalNoMes(data)
  const lista = [
    { id: 'dia', label: `Mensal no dia ${data.getDate()}`, extra: { diaDoMes: data.getDate() } },
    { id: `semana${n}`, label: `Mensal ${ordinalPorExtenso(n, codigo)}`, extra: { ordinal: n, diaDaSemana: codigo } },
  ]
  if (n !== -1 && ehUltimaDoMes(data)) {
    lista.push({ id: 'semana-1', label: `Mensal ${ordinalPorExtenso(-1, codigo)}`, extra: { ordinal: -1, diaDaSemana: codigo } })
  }
  return lista
}

function listaDeNomes(nomes) {
  if (nomes.length <= 1) return nomes.join('')
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
}

function dataPorExtenso(dataISO) {
  const d = fromInputs(dataISO)
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`
}

// A regra em uma frase, para o seletor mostrar o que foi escolhido no
// "Personalizar" ("A cada 2 semanas: segunda e quarta, até 30 de novembro").
export function descreverRegra(regra, data) {
  if (!regra) return 'Não se repete'
  const n = regra.intervalo
  let texto
  if (regra.freq === 'DAILY') texto = n > 1 ? `A cada ${n} dias` : 'Todos os dias'
  if (regra.freq === 'WEEKLY') {
    const uteis = regra.dias.length === 5 && DIAS_UTEIS.every((d) => regra.dias.includes(d))
    const dias = uteis ? 'segunda a sexta-feira' : listaDeNomes(regra.dias.map((d) => nomeDoDia(d).replace('-feira', '')))
    texto = n > 1 ? `A cada ${n} semanas: ${dias}` : `Semanal: ${dias}`
  }
  if (regra.freq === 'MONTHLY') {
    const quando = regra.diaDaSemana ? ordinalPorExtenso(regra.ordinal, regra.diaDaSemana) : `no dia ${regra.diaDoMes}`
    texto = n > 1 ? `A cada ${n} meses, ${quando}` : `Mensal, ${quando}`
  }
  if (regra.freq === 'YEARLY') {
    const quando = `em ${data.getDate()} de ${MESES[data.getMonth()]}`
    texto = n > 1 ? `A cada ${n} anos, ${quando}` : `Anual, ${quando}`
  }
  if (regra.fim?.tipo === 'data' && regra.fim.data) texto += `, até ${dataPorExtenso(regra.fim.data)}`
  if (regra.fim?.tipo === 'vezes') texto += `, ${regra.fim.vezes} ${regra.fim.vezes === 1 ? 'vez' : 'vezes'}`
  return texto
}

// ---------- séries ----------

// Quando o compromisso muda de dia, a regra que "era o dia dele" acompanha:
// a reunião semanal de quinta movida para sexta passa a ser de sexta. Uma
// regra que já não era o dia dele (segunda e quarta) fica como está — é o
// que o Google faz.
export function acompanharData(regra, antiga, nova) {
  if (!regra) return regra
  if (regra.freq === 'WEEKLY' && regra.dias.length === 1 && regra.dias[0] === codigoDoDia(antiga)) {
    return { ...regra, dias: [codigoDoDia(nova)] }
  }
  if (regra.freq === 'MONTHLY' && regra.diaDoMes === antiga.getDate()) {
    return { ...regra, diaDoMes: nova.getDate() }
  }
  if (regra.freq === 'MONTHLY' && regra.diaDaSemana === codigoDoDia(antiga)) {
    const eraDoDia = regra.ordinal === ordinalNoMes(antiga) || (regra.ordinal === -1 && ehUltimaDoMes(antiga))
    if (eraDoDia) {
      const ordinal = regra.ordinal === -1 && ehUltimaDoMes(nova) ? -1 : ordinalNoMes(nova)
      return { ...regra, ordinal, diaDaSemana: codigoDoDia(nova) }
    }
  }
  return regra
}

// "Este e os seguintes" corta a série antiga logo antes da ocorrência
// escolhida. Funciona em qualquer regra, inclusive as que o editor não sabe
// montar: só troca o término de cada RRULE, e o resto da linha fica igual.
export function encerrarAntes(recurrence, inicioDaOcorrencia, allDay) {
  const until = allDay
    ? toDateInput(addDays(inicioDaOcorrencia, -1)).replace(/-/g, '')
    : new Date(inicioDaOcorrencia.getTime() - 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return (recurrence || []).map((linha) => {
    if (!linha.startsWith('RRULE:')) return linha
    const partes = linha.slice(6).split(';').filter((p) => p && !/^(COUNT|UNTIL)=/i.test(p))
    return `RRULE:${[...partes, `UNTIL=${until}`].join(';')}`
  })
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
