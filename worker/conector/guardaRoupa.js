// As ferramentas do guarda-roupa. Como em ferramentas.js, sem regra própria:
// o formato das peças e dos looks, o registro de uso e a mesclagem com o
// Drive são os de src/lib/guardaRoupa.js, os mesmos que o app usa.
//
// É por aqui que entra a inteligência do módulo: uma tarefa agendada do
// Claude olha as fotos das peças pendentes (ver_peca devolve a imagem),
// classifica, e grava o look do dia que o app mostra na tela inicial.

import {
  CATEGORIAS,
  OCASIOES,
  TEMPERATURAS,
  PENDENTE,
  USEI,
  ROTULO_DO_FEEDBACK,
  rotuloDaCategoria,
  rotulosDe,
  normalizarGuardaRoupa,
  classificarPeca,
  diasParada,
  filtrarPecas,
  ordenarPecas,
  lookDoDia,
  salvarLook,
  registrarFeedback,
  historicoDeLooks,
  mesclarGuardaRoupa,
} from '../../src/lib/guardaRoupa.js'
import { ErroDeUso, carimboDepois } from './ferramentas.js'
import { dataNoFuso, dataComDia } from './tempo.js'

// Acima disso a imagem não cabe bem numa resposta de ferramenta. As fotos
// que o app envia ficam muito abaixo (lado maior de 1024px, JPEG).
const LIMITE_DA_FOTO = 4 * 1024 * 1024

async function ler(api, agora) {
  return normalizarGuardaRoupa(await api.drive.loadGuardaRoupa(), agora)
}

// Ler → mudar → mesclar com o que está no Drive → gravar, como alterarNotas.
async function alterar(api, agora, mudar) {
  const remoto = await ler(api, agora)
  const carimbo = (registro) => carimboDepois(agora, registro?.updatedAt)
  const { estado, resultado } = mudar(remoto, carimbo)
  const mesclado = mesclarGuardaRoupa({ ...estado, deleted: [] }, remoto, agora.getTime())
  await api.drive.saveGuardaRoupa(mesclado)
  return resultado
}

function acharPeca(pecas, id) {
  const peca = pecas.find((p) => p.id === id)
  if (!peca) throw new ErroDeUso(`Não existe peça com o id "${id}". Use listar_guarda_roupa para ver os ids.`)
  return peca
}

function usoEmTexto(p, hoje) {
  const dias = diasParada(p, hoje)
  if (!p.ultimoUso) return `nunca usada (cadastrada há ${dias} dia${dias === 1 ? '' : 's'})`
  return `${p.usos} uso${p.usos === 1 ? '' : 's'} · último em ${dataComDia(p.ultimoUso, { ano: false })} (há ${dias} dia${dias === 1 ? '' : 's'})`
}

function classificacaoEmTexto(p) {
  return [
    rotuloDaCategoria(p.categoria) || 'sem categoria',
    p.cor && `cor ${p.cor}`,
    p.ocasioes.length ? `ocasião: ${rotulosDe(OCASIOES, p.ocasioes).join(', ').toLowerCase()}` : null,
    p.temperaturas.length ? `temperatura: ${rotulosDe(TEMPERATURAS, p.temperaturas).join(', ').toLowerCase()}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function linhaDaPeca(p, hoje) {
  const marcas = [p.status === PENDENTE ? 'PENDENTE de classificação' : null, p.ativa ? null : 'desativada'].filter(Boolean)
  return `- ${p.nome || '(sem nome)'} [peça: ${p.id}] · ${classificacaoEmTexto(p)} · ${usoEmTexto(p, hoje)}${marcas.length ? ` · ${marcas.join(' · ')}` : ''}${p.observacoes ? ` — obs.: ${p.observacoes}` : ''}`
}

export async function listarGuardaRoupa(api, agora, { status = 'todas', categoria, incluir_desativadas: inativas = false, limite = 100 } = {}) {
  const { pecas } = await ler(api, agora)
  const hoje = dataNoFuso(agora)
  const achadas = ordenarPecas(filtrarPecas(pecas, { categoria, status: status === 'todas' ? '' : status, inativas }), 'paradas', hoje)
  const pendentes = pecas.filter((p) => p.ativa && p.status === PENDENTE).length
  const cabecalho = `# Guarda-roupa — ${achadas.length} peça${achadas.length === 1 ? '' : 's'}${pendentes ? ` (${pendentes} pendente${pendentes === 1 ? '' : 's'} de classificação no total)` : ''}`
  if (!pecas.length) return 'O guarda-roupa está vazio. As peças são cadastradas pela pessoa no app (tela Guarda-roupa), com foto.'
  if (!achadas.length) return `${cabecalho}\nNenhuma peça com esse filtro.`
  const linhas = achadas.slice(0, limite).map((p) => linhaDaPeca(p, hoje))
  if (achadas.length > limite) linhas.push(`(há mais ${achadas.length - limite} — peça com um limite maior ou um filtro)`)
  return `${cabecalho}\nDa parada há mais tempo para a usada por último.\n${linhas.join('\n')}`
}

function paraBase64(bytes) {
  let binario = ''
  // Em pedaços: String.fromCharCode com a foto inteira estoura a pilha.
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binario)
}

// Os dados da peça e a foto como imagem MCP. Se a foto não vier (apagada do
// Drive, permissão), os dados seguem assim mesmo, com o motivo dito — o
// Claude não deve classificar no escuro, e precisa saber por quê.
export async function verPeca(api, agora, { id }, { traduzirErro = (e) => e.message } = {}) {
  const { pecas } = await ler(api, agora)
  const p = acharPeca(pecas, id)
  const texto = [
    `# ${p.nome || '(sem nome)'} [peça: ${p.id}]`,
    `Status: ${p.status}${p.ativa ? '' : ' · desativada (fora dos looks)'}`,
    `Classificação: ${classificacaoEmTexto(p)}`,
    `Uso: ${usoEmTexto(p, dataNoFuso(agora))}`,
    p.observacoes ? `Observações: ${p.observacoes}` : null,
    `Cadastrada em ${dataComDia(dataNoFuso(new Date(p.cadastradaEm)))}`,
  ]
    .filter(Boolean)
    .join('\n')
  let foto
  try {
    foto = await api.fotos.baixar(p.foto.driveId)
  } catch (err) {
    return `${texto}\n\n(Não deu para trazer a foto: ${traduzirErro(err)})`
  }
  if (foto.bytes.length > LIMITE_DA_FOTO) return `${texto}\n\n(A foto é grande demais para vir aqui. Link: ${p.foto.url})`
  return {
    content: [
      { type: 'text', text: texto },
      { type: 'image', data: paraBase64(foto.bytes), mimeType: foto.mimeType || 'image/jpeg' },
    ],
  }
}

export async function atualizarPeca(api, agora, { id, nome, categoria, cor, ocasioes, temperaturas, observacoes, ativa }) {
  return alterar(api, agora, (estado, carimbo) => {
    const atual = acharPeca(estado.pecas, id)
    const nova = classificarPeca(atual, { nome, categoria, cor, ocasioes, temperaturas, observacoes, ativa }, carimbo(atual))
    return {
      estado: { ...estado, pecas: estado.pecas.map((p) => (p.id === id ? nova : p)) },
      resultado: `Peça classificada: ${linhaDaPeca(nova, dataNoFuso(agora)).slice(2)}`,
    }
  })
}

function lookEmTexto(look, pecas) {
  const porId = new Map(pecas.map((p) => [p.id, p]))
  const linhas = look.pecas.map((id) => {
    const p = porId.get(id)
    return p ? `- ${p.nome || '(sem nome)'} [peça: ${p.id}] · ${classificacaoEmTexto(p)}` : `- (peça removida do guarda-roupa) [peça: ${id}]`
  })
  const feedback = look.feedback ? `${ROTULO_DO_FEEDBACK[look.feedback]}${look.motivo ? ` — ${look.motivo}` : ''}` : 'ainda sem resposta'
  return [`## Look de ${dataComDia(look.data)}`, ...linhas, look.texto ? `Por quê: ${look.texto}` : null, look.clima ? `Clima: ${look.clima}` : null, `Feedback: ${feedback}`]
    .filter(Boolean)
    .join('\n')
}

export async function salvarLookDoDia(api, agora, { data, pecas: idsDasPecas, texto, clima }) {
  const dia = data || dataNoFuso(agora)
  return alterar(api, agora, (estado, carimbo) => {
    const escolhidas = [...new Set(idsDasPecas)].map((id) => acharPeca(estado.pecas, id))
    const inativas = escolhidas.filter((p) => !p.ativa)
    if (inativas.length) {
      throw new ErroDeUso(`Peça desativada não entra em look: ${inativas.map((p) => `${p.nome || '(sem nome)'} [peça: ${p.id}]`).join(', ')}. Escolha outra.`)
    }
    const havia = lookDoDia(estado.looks, dia)
    const { pecas, looks, look } = salvarLook(estado, { data: dia, pecas: escolhidas.map((p) => p.id), texto, clima }, agora, carimbo)
    return {
      estado: { ...estado, pecas, looks },
      resultado: `${havia ? 'Look substituído' : 'Look salvo'} — aparece no cartão "Look do dia" do app.\n${lookEmTexto(look, pecas)}`,
    }
  })
}

export async function verLookDoDia(api, agora, { data } = {}) {
  const dia = data || dataNoFuso(agora)
  const { pecas, looks } = await ler(api, agora)
  const look = lookDoDia(looks, dia)
  if (!look) return `Não há look salvo para ${dataComDia(dia)}. Use salvar_look_do_dia para gravar um.`
  return lookEmTexto(look, pecas)
}

export async function registrarFeedbackLook(api, agora, { data, feedback, motivo }) {
  const dia = data || dataNoFuso(agora)
  return alterar(api, agora, (estado, carimbo) => {
    const feito = registrarFeedback(estado, { data: dia, feedback, motivo }, agora, carimbo)
    if (!feito) throw new ErroDeUso(`Não há look salvo para ${dataComDia(dia)}. Use historico_looks para ver as datas que têm look.`)
    const jaEra = lookDoDia(estado.looks, dia).feedback === feedback
    const efeito = feedback === USEI ? (jaEra ? ' O uso das peças já estava contado.' : ' Cada peça do look ganhou um uso e a data do último uso.') : ''
    return {
      estado: { ...estado, pecas: feito.pecas, looks: feito.looks },
      resultado: `Feedback gravado: ${ROTULO_DO_FEEDBACK[feedback]}.${efeito}\n${lookEmTexto(feito.look, feito.pecas)}`,
    }
  })
}

export async function historicoLooks(api, agora, { dias = 14 } = {}) {
  const { pecas, looks } = await ler(api, agora)
  const recentes = historicoDeLooks(looks, dataNoFuso(agora), dias)
  if (!recentes.length) return `Nenhum look salvo nos últimos ${dias} dias.`
  return `# Looks dos últimos ${dias} dias (${recentes.length})\n\n${recentes.map((l) => lookEmTexto(l, pecas)).join('\n\n')}`
}

export const VALORES = {
  categorias: CATEGORIAS.map((c) => c.id),
  ocasioes: OCASIOES.map((o) => o.id),
  temperaturas: TEMPERATURAS.map((t) => t.id),
}
