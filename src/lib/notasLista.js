import { combinaComABusca } from './notasBusca.js'
import { textoSemMarcacao } from './notasLinks.js'

// A lista de anotações no jeito do app Notas do iPhone: fixadas primeiro, o
// resto agrupado pela data da última edição (Hoje, Ontem, 7 dias...), cada
// linha com título, hora e o começo do texto. Antes eram abas — com meia
// dúzia de anotações, cada aba encolhia até o título sumir e sobrar só o ✕.

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const DIA_MS = 24 * 60 * 60 * 1000

function linhasDoCorpo(note) {
  return (note.body || '').split('\n').map((l) => l.trim()).filter(Boolean)
}

// Como no Notas: sem título, a primeira linha do texto faz esse papel.
export function tituloDaNota(note) {
  return note.title?.trim() || linhasDoCorpo(note)[0]?.slice(0, 80) || 'Nova anotação'
}

export function previaDaNota(note) {
  const linhas = linhasDoCorpo(note)
  const previa = note.title?.trim() ? linhas[0] : linhas[1]
  return previa ? textoSemMarcacao(previa).slice(0, 120) : 'Nenhum texto adicional'
}

function inicioDoDia(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function diasAtras(data, agora) {
  return Math.round((inicioDoDia(agora) - inicioDoDia(data)) / DIA_MS)
}

export function grupoDaData(iso, agora) {
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return 'Mais antigas'
  const dias = diasAtras(data, agora)
  if (dias <= 0) return 'Hoje'
  if (dias === 1) return 'Ontem'
  if (dias < 7) return '7 dias anteriores'
  if (dias < 30) return '30 dias anteriores'
  if (data.getFullYear() === agora.getFullYear()) return MESES[data.getMonth()].replace(/^./, (c) => c.toUpperCase())
  return String(data.getFullYear())
}

// Hora para hoje, dia da semana para a última semana, data para o resto.
export function dataCurta(iso, agora) {
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return ''
  const dias = diasAtras(data, agora)
  if (dias <= 0) return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (dias === 1) return 'Ontem'
  if (dias < 7) return DIAS[data.getDay()]
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

// O carimbo no topo do editor ("22 de outubro de 2026 às 23:30").
export function dataPorExtenso(iso) {
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return ''
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${data.getDate()} de ${MESES[data.getMonth()]} de ${data.getFullYear()} às ${hora}`
}

export function notaVazia(note) {
  return !note.title?.trim() && !note.body?.trim()
}

// Seções prontas para a tela, já filtradas pela busca: todas as palavras,
// em qualquer ordem e sem acento (ver combinaComABusca, a mesma regra do
// conector do Claude).
export function organizarNotas(notes, agora, busca = '') {
  const filtradas = (notes || [])
    .filter((n) => combinaComABusca(n, busca))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))

  const secoes = []
  const fixadas = filtradas.filter((n) => n.fixada)
  if (fixadas.length) secoes.push({ titulo: 'Fixadas', notas: fixadas })
  for (const nota of filtradas.filter((n) => !n.fixada)) {
    const titulo = grupoDaData(nota.updatedAt, agora)
    const ultima = secoes[secoes.length - 1]
    if (ultima && ultima.titulo === titulo && ultima.titulo !== 'Fixadas') ultima.notas.push(nota)
    else secoes.push({ titulo, notas: [nota] })
  }
  return secoes
}
