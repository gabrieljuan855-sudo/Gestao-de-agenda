// O guarda-roupa: as peças (cada uma com a foto no Drive) e o look de cada
// dia. Lógica pura, a mesma para o app e para o conector do Claude — é o
// conector que classifica as peças e monta o look da manhã, e o app que
// mostra e recebe o "usei"/"não gostei".
//
// Tudo mora num arquivo só (guarda-roupa.json, na pasta privada do Drive),
// como as anotações: dezenas de peças e um look por dia cabem numa leitura.
// As fotos ficam fora dele, na pasta "Guarda-roupa" do Drive visível.

import { mesclarAnotacoes, mesclarApagadas } from './notesMerge.js'

export const CATEGORIAS = [
  { id: 'parte-de-cima', rotulo: 'Parte de cima' },
  { id: 'parte-de-baixo', rotulo: 'Parte de baixo' },
  { id: 'calcado', rotulo: 'Calçado' },
  { id: 'agasalho', rotulo: 'Agasalho' },
  { id: 'acessorio', rotulo: 'Acessório' },
]
export const OCASIOES = [
  { id: 'trabalho', rotulo: 'Trabalho' },
  { id: 'formal', rotulo: 'Formal' },
  { id: 'casual', rotulo: 'Casual' },
  { id: 'esporte', rotulo: 'Esporte' },
]
export const TEMPERATURAS = [
  { id: 'frio', rotulo: 'Frio' },
  { id: 'ameno', rotulo: 'Ameno' },
  { id: 'calor', rotulo: 'Calor' },
]
export const PENDENTE = 'pendente'
export const CLASSIFICADA = 'classificada'
export const USEI = 'usei'
export const NAO_GOSTEI = 'nao_gostei'
export const ROTULO_DO_FEEDBACK = { [USEI]: 'usei', [NAO_GOSTEI]: 'não gostei' }

const ids = (lista) => lista.map((x) => x.id)
const rotuloEm = (lista, id) => lista.find((x) => x.id === id)?.rotulo || ''
export const rotuloDaCategoria = (id) => rotuloEm(CATEGORIAS, id)
export const rotulosDe = (lista, escolhidos = []) => escolhidos.map((id) => rotuloEm(lista, id)).filter(Boolean)

const DATA = /^\d{4}-\d{2}-\d{2}$/
const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const dataOuNada = (v) => (typeof v === 'string' && DATA.test(v) ? v : null)
const isoOuAgora = (v, agora) => (Number.isFinite(Date.parse(v || '')) ? new Date(v).toISOString() : agora.toISOString())
// Uma calça serve para o trabalho e para o fim de semana: ocasião e
// temperatura aceitam mais de um valor. Um valor solto (texto) também entra,
// para quem mandar "casual" em vez de ["casual"].
function escolhas(v, validos) {
  const lista = Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []
  return validos.filter((id) => lista.includes(id))
}

function novoId(prefixo) {
  const acaso = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${prefixo}-${acaso.replace(/-/g, '').slice(0, 12)}`
}

// O que vier de fora (o Drive, o cache, o Claude) passa por aqui antes de
// virar peça: campo desconhecido cai, valor fora da lista vira vazio. Sem id
// ou sem foto não é peça — devolve null.
export function normalizarPeca(bruta, agora = new Date()) {
  if (!bruta || typeof bruta !== 'object' || typeof bruta.id !== 'string' || !bruta.id) return null
  const driveId = texto(bruta.foto?.driveId, 200)
  if (!driveId) return null
  return {
    id: bruta.id,
    foto: { driveId, url: texto(bruta.foto?.url, 2000) },
    nome: texto(bruta.nome, 120),
    categoria: ids(CATEGORIAS).includes(bruta.categoria) ? bruta.categoria : '',
    cor: texto(bruta.cor, 60),
    ocasioes: escolhas(bruta.ocasioes, ids(OCASIOES)),
    temperaturas: escolhas(bruta.temperaturas, ids(TEMPERATURAS)),
    observacoes: texto(bruta.observacoes, 1000),
    status: bruta.status === CLASSIFICADA ? CLASSIFICADA : PENDENTE,
    ativa: bruta.ativa !== false,
    cadastradaEm: isoOuAgora(bruta.cadastradaEm, agora),
    ultimoUso: dataOuNada(bruta.ultimoUso),
    usos: Number.isInteger(bruta.usos) && bruta.usos > 0 ? bruta.usos : 0,
    updatedAt: isoOuAgora(bruta.updatedAt, agora),
  }
}

export function normalizarPecas(lista, agora = new Date()) {
  return (Array.isArray(lista) ? lista : []).map((p) => normalizarPeca(p, agora)).filter(Boolean)
}

// O look é um por dia: a data é a identidade dele (e o `id`, para a mesma
// mesclagem por id e última edição das anotações servir aqui).
export function normalizarLook(bruto, agora = new Date()) {
  const data = dataOuNada(bruto?.data)
  if (!data) return null
  const pecas = [...new Set((Array.isArray(bruto.pecas) ? bruto.pecas : []).filter((id) => typeof id === 'string' && id))]
  const feedback = [USEI, NAO_GOSTEI].includes(bruto.feedback) ? bruto.feedback : ''
  return {
    id: data,
    data,
    pecas,
    texto: texto(bruto.texto, 2000),
    clima: texto(bruto.clima, 300),
    feedback,
    motivo: feedback ? texto(bruto.motivo, 500) : '',
    updatedAt: isoOuAgora(bruto.updatedAt, agora),
  }
}

export function normalizarLooks(lista, agora = new Date()) {
  return (Array.isArray(lista) ? lista : []).map((l) => normalizarLook(l, agora)).filter(Boolean)
}

export function normalizarGuardaRoupa(bruto, agora = new Date()) {
  return {
    pecas: normalizarPecas(bruto?.pecas, agora),
    looks: normalizarLooks(bruto?.looks, agora),
    deleted: Array.isArray(bruto?.deleted) ? bruto.deleted.filter((d) => d?.id && d?.at) : [],
  }
}

// Está classificada quando tem o mínimo para entrar num look: o que é e para
// quando serve. Cadastrar sem preencher nada deixa "pendente", e é a fila
// que o Claude esvazia olhando a foto.
function statusPelosCampos(p) {
  return p.categoria && (p.ocasioes.length || p.temperaturas.length) ? CLASSIFICADA : PENDENTE
}

export function novaPeca({ foto, ...campos }, agora = new Date()) {
  const peca = normalizarPeca(
    { ...campos, id: novoId('peca'), foto, ativa: true, usos: 0, ultimoUso: null, cadastradaEm: agora.toISOString(), updatedAt: agora.toISOString() },
    agora
  )
  return peca && { ...peca, status: statusPelosCampos(peca) }
}

// Edição feita no app: o status acompanha os campos, mas nunca volta para
// "pendente" uma peça que já foi classificada (pelo Claude ou à mão).
export function editarPeca(peca, campos, agora = new Date()) {
  const nova = normalizarPeca({ ...peca, ...campos, id: peca.id, foto: peca.foto, updatedAt: agora.toISOString() }, agora)
  return { ...nova, status: peca.status === CLASSIFICADA ? CLASSIFICADA : statusPelosCampos(nova) }
}

// Classificação feita pelo conector: só os campos informados mudam, e a peça
// sai da fila de pendentes.
export function classificarPeca(peca, campos, carimbo) {
  const informados = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined))
  return { ...normalizarPeca({ ...peca, ...informados, id: peca.id, foto: peca.foto, updatedAt: carimbo }), status: CLASSIFICADA }
}

// ---------- uso ----------

function diasEntre(deIso, ateIso) {
  return Math.round((Date.parse(`${ateIso}T00:00:00Z`) - Date.parse(`${deIso}T00:00:00Z`)) / 86400000)
}

// Há quantos dias a peça está parada: desde o último uso ou, para a que
// nunca foi usada, desde o cadastro — peça comprada e esquecida é justamente
// a que mais interessa achar. `hoje` é AAAA-MM-DD.
export function diasParada(peca, hoje) {
  const desde = peca.ultimoUso || dataLocalDe(peca.cadastradaEm)
  return Math.max(0, diasEntre(desde, hoje))
}

// A data (AAAA-MM-DD) de um instante no fuso de Brasília, que é onde a
// pessoa se veste. Fixo, como no conector (tempo.js), para "hoje" ser o
// mesmo dia nos dois lados.
export function dataLocalDe(instante) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(instante))
}

export function textoDoUso(peca, hoje) {
  const dias = diasParada(peca, hoje)
  const quanto = dias === 0 ? 'hoje' : dias === 1 ? 'há 1 dia' : `há ${dias} dias`
  if (!peca.ultimoUso) return dias === 0 ? 'Nunca usada' : `Nunca usada · cadastrada ${quanto}`
  return dias === 0 ? 'Usada hoje' : `Parada ${quanto}`
}

export const ORDENS = [
  { id: 'recentes', rotulo: 'Cadastradas por último' },
  { id: 'paradas', rotulo: 'Paradas há mais tempo' },
  { id: 'usadas', rotulo: 'Mais usadas' },
]

export function ordenarPecas(pecas, ordem, hoje) {
  const lista = [...pecas]
  if (ordem === 'paradas') return lista.sort((a, b) => diasParada(b, hoje) - diasParada(a, hoje) || a.usos - b.usos)
  if (ordem === 'usadas') return lista.sort((a, b) => b.usos - a.usos)
  return lista.sort((a, b) => Date.parse(b.cadastradaEm) - Date.parse(a.cadastradaEm))
}

export function filtrarPecas(pecas, { categoria = '', status = '', inativas = false } = {}) {
  return pecas.filter(
    (p) => (inativas || p.ativa) && (!categoria || p.categoria === categoria) && (!status || p.status === status)
  )
}

// ---------- looks ----------

export function lookDoDia(looks, data) {
  return looks.find((l) => l.data === data) || null
}

// O último uso de uma peça sai dos looks marcados "usei": é o que permite
// desfazer um "usei" (trocar para "não gostei", ou substituir o look) sem
// guardar o valor anterior em lugar nenhum.
function ultimoUsoPelosLooks(pecaId, looks) {
  const datas = looks.filter((l) => l.feedback === USEI && l.pecas.includes(pecaId)).map((l) => l.data)
  return datas.length ? datas.sort().at(-1) : null
}

function reverterUso(pecas, look, looksSemEle, carimbo) {
  return pecas.map((p) =>
    look.pecas.includes(p.id)
      ? { ...p, usos: Math.max(0, p.usos - 1), ultimoUso: ultimoUsoPelosLooks(p.id, looksSemEle), updatedAt: carimbo(p) }
      : p
  )
}

// `carimbo(registro)` devolve o updatedAt da edição: o app usa a hora de
// agora; o conector, carimboDepois (ver ferramentas.js), para a edição
// ganhar da versão que acabou de ler.
const carimboDe = (agora) => () => agora.toISOString()

// Grava o look de uma data, no lugar do que houver. Substituir um look que
// já tinha sido marcado "usei" desfaz aquele uso: o look novo começa sem
// feedback, e contar um uso de um look que não existe mais seria mentira.
export function salvarLook({ pecas, looks }, { data, pecas: idsDasPecas, texto: explicacao, clima }, agora = new Date(), carimbo = carimboDe(agora)) {
  const anterior = lookDoDia(looks, data)
  const outros = looks.filter((l) => l.data !== data)
  const look = normalizarLook({ data, pecas: idsDasPecas, texto: explicacao, clima, updatedAt: carimbo(anterior || {}) }, agora)
  return {
    pecas: anterior?.feedback === USEI ? reverterUso(pecas, anterior, outros, carimbo) : pecas,
    looks: [look, ...outros],
    look,
  }
}

// O "Usei este" / "Não gostei" — a regra única do botão do app e da
// ferramenta registrar_feedback_look. "Usei" grava em cada peça do look a
// data dele como último uso e soma um uso; repetir o mesmo feedback não
// conta de novo, e sair de "usei" devolve o que foi somado.
export function registrarFeedback({ pecas, looks }, { data, feedback, motivo = '' }, agora = new Date(), carimbo = carimboDe(agora)) {
  const atual = lookDoDia(looks, data)
  if (!atual) return null
  const novo = normalizarLook({ ...atual, feedback, motivo, updatedAt: carimbo(atual) }, agora)
  const outros = looks.filter((l) => l.data !== data)
  let novasPecas = pecas
  if (atual.feedback === USEI && novo.feedback !== USEI) novasPecas = reverterUso(pecas, atual, outros, carimbo)
  if (atual.feedback !== USEI && novo.feedback === USEI) {
    novasPecas = pecas.map((p) =>
      novo.pecas.includes(p.id)
        ? { ...p, usos: p.usos + 1, ultimoUso: p.ultimoUso && p.ultimoUso > data ? p.ultimoUso : data, updatedAt: carimbo(p) }
        : p
    )
  }
  return { pecas: novasPecas, looks: [novo, ...outros], look: novo }
}

export function historicoDeLooks(looks, hoje, dias) {
  return looks.filter((l) => l.data <= hoje && diasEntre(l.data, hoje) < dias).sort((a, b) => (a.data < b.data ? 1 : -1))
}

// ---------- gravação ----------

// O app e o conector gravam no mesmo arquivo: toda gravação junta o que este
// lado tem com o que está no Drive agora (por id e última edição), com o
// rastro das peças excluídas valendo nos dois sentidos — a mesma regra das
// anotações (notesMerge.js). Look não se exclui, então não deixa rastro.
export function mesclarGuardaRoupa(local, remoto, agora = Date.now()) {
  const deleted = mesclarApagadas(local?.deleted || [], remoto?.deleted || [], agora)
  const rastro = new Map(deleted.map((d) => [d.id, Date.parse(d.at)]))
  const viva = (p) => !(rastro.has(p.id) && rastro.get(p.id) >= Date.parse(p.updatedAt))
  return {
    pecas: mesclarAnotacoes((local?.pecas || []).filter(viva), (remoto?.pecas || []).filter(viva), deleted),
    looks: mesclarAnotacoes(local?.looks || [], remoto?.looks || [], []),
    deleted,
  }
}

// Se a mesclagem tem algo que o outro lado não tem (ou tem mais novo).
export function difere(a, b) {
  const assinatura = (x) =>
    JSON.stringify([
      (x?.pecas || []).map((p) => [p.id, p.updatedAt]).sort(),
      (x?.looks || []).map((l) => [l.id, l.updatedAt]).sort(),
      (x?.deleted || []).map((d) => d.id).sort(),
    ])
  return assinatura(a) !== assinatura(b)
}

export const NOME_DO_ARQUIVO_DA_FOTO = (agora = new Date()) => `peca-${agora.toISOString().replace(/[:.]/g, '-')}.jpg`
