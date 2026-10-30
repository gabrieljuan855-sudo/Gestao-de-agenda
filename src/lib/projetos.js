import { etiqueta } from './gtd.js'
import { compararPorPrioridadeEPrazo, isOverdueTask } from './tasks.js'

// Um projeto deixou de ser só a etiqueta #nome repetida em várias tarefas: ele
// tem ficha própria (o que é, como se sabe que terminou, em que pé está), e é
// o lugar onde tarefas, anotações e compromissos de um mesmo caso se juntam.
//
// A etiqueta continua sendo a ligação com as tarefas — o `id` do projeto É a
// etiqueta (etiqueta() de gtd.js), então tudo que já estava marcado com
// #caso-maria cai sozinho no projeto "caso-maria", sem migrar nada no Google
// Tasks. A ficha é só o que o Tasks não tem onde guardar.

export const SITUACOES = [
  { id: 'ativo', label: 'Ativo' },
  { id: 'pausado', label: 'Pausado' },
  { id: 'concluido', label: 'Concluído' },
]
const ORDEM_SITUACAO = { ativo: 0, pausado: 1, concluido: 2 }

// Projeto tem chegada; rotina não. "Reunião de Equipe" não termina nunca —
// é uma pauta que se renova a cada encontro —, e tratá-la como projeto a
// deixava sempre "atrasada" e cobrada por próxima ação, distorcendo a lista
// inteira. Rotina não entra na cobrança de "parado" nem de "sem resultado".
export const TIPOS = [
  { id: 'projeto', label: 'Projeto — tem um resultado e termina' },
  { id: 'rotina', label: 'Rotina — reunião ou área que continua sempre' },
]

// Marca privada no evento do Calendar que diz a qual projeto ele pertence —
// o mesmo mecanismo que os blocos de foco e os registros de conclusão já usam
// para se reconhecer (extendedProperties.private).
export const PROJETO_PROP = 'segundoCerebroProjeto'

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

// A ficha vem do Drive e do cache local: nenhum dos dois é garantia de
// formato. Só os campos conhecidos passam, cada um com o tipo certo — a
// mesma lição da anotação que travou a sincronização (sanitizeNote).
export function normalizarProjeto(p, agora = new Date()) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) return null
  const iso = agora.toISOString()
  return {
    id: p.id,
    nome: typeof p.nome === 'string' && p.nome.trim() ? p.nome.trim() : p.id,
    resultado: typeof p.resultado === 'string' ? p.resultado : '',
    situacao: ORDEM_SITUACAO[p.situacao] !== undefined ? p.situacao : 'ativo',
    tipo: p.tipo === 'rotina' ? 'rotina' : 'projeto',
    prazo: DATA_ISO.test(p.prazo || '') ? p.prazo : null,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : iso,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : iso,
    arquivos: normalizarArquivos(p.arquivos),
    // A pasta do projeto no Drive, criada no primeiro arquivo enviado.
    ...(normalizarPasta(p.pasta) ? { pasta: normalizarPasta(p.pasta) } : {}),
    // Projeto com dados sensíveis (um caso atendido) pode recusar a IA de vez.
    ...(p.semIA === true ? { semIA: true } : {}),
    // Opcional como semIA: ficha sem marcos continua com o formato de antes.
    ...(Array.isArray(p.marcos) && normalizarMarcos(p.marcos).length ? { marcos: normalizarMarcos(p.marcos) } : {}),
  }
}

// ---------- marcos ----------
//
// Próxima ação diz o que fazer agora; marco diz onde o projeto precisa estar
// e quando ("relatório entregue até 30/11"). Sem eles, um projeto longo só
// tem o prazo final — e descobre-se atrasado no último mês.

export function normalizarMarcos(lista) {
  return (Array.isArray(lista) ? lista : [])
    .filter((m) => m && typeof m.id === 'string' && typeof m.titulo === 'string' && m.titulo.trim())
    .map((m) => ({
      id: m.id,
      titulo: m.titulo.trim().slice(0, 120),
      data: DATA_ISO.test(m.data || '') ? m.data : null,
      feito: m.feito === true,
    }))
    .sort(compararMarcos)
}

// Pendentes antes dos feitos; entre eles, por data, e sem data por último.
function compararMarcos(a, b) {
  if (a.feito !== b.feito) return a.feito ? 1 : -1
  if (a.data !== b.data) return !a.data ? 1 : !b.data ? -1 : a.data < b.data ? -1 : 1
  return 0
}

export function adicionarMarco(marcos, { titulo, data }, agora = new Date()) {
  const limpo = typeof titulo === 'string' ? titulo.trim() : ''
  if (!limpo) return normalizarMarcos(marcos)
  const id = `m${agora.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  return normalizarMarcos([...(marcos || []), { id, titulo: limpo, data, feito: false }])
}

export function alternarMarco(marcos, id) {
  return normalizarMarcos((marcos || []).map((m) => (m.id === id ? { ...m, feito: !m.feito } : m)))
}

export function removerMarco(marcos, id) {
  return normalizarMarcos((marcos || []).filter((m) => m.id !== id))
}

// O marco pendente mais próximo, e se já passou da data.
export function proximoMarco(marcos, hojeIso) {
  const m = normalizarMarcos(marcos).find((x) => !x.feito)
  if (!m) return null
  return { ...m, atrasado: Boolean(m.data && hojeIso && m.data < hojeIso) }
}

// ---------- arquivos do projeto ----------
//
// Dois jeitos de um arquivo entrar no projeto: enviado do computador (ou
// criado ali mesmo, como Documento, Planilha ou Apresentação), indo para a
// pasta do projeto no Drive; ou vinculado por link, para o que já mora em
// outro lugar (um site, um sistema, um arquivo antigo do Drive). Nos dois
// casos o projeto guarda o link — e, no primeiro, também o id do Drive e o
// tipo do arquivo.

const TIPOS_DE_ARQUIVO = [
  { tipo: 'doc', rotulo: 'Documento', re: /docs\.google\.com\/document\//i },
  { tipo: 'planilha', rotulo: 'Planilha', re: /docs\.google\.com\/spreadsheets\//i },
  { tipo: 'apresentacao', rotulo: 'Apresentação', re: /docs\.google\.com\/presentation\//i },
  { tipo: 'formulario', rotulo: 'Formulário', re: /docs\.google\.com\/forms\/|forms\.gle\//i },
  { tipo: 'pasta', rotulo: 'Pasta do Drive', re: /drive\.google\.com\/drive\/(u\/\d+\/)?folders\//i },
  { tipo: 'pdf', rotulo: 'PDF', re: /\.pdf(\?|#|$)/i },
  { tipo: 'drive', rotulo: 'Arquivo do Drive', re: /drive\.google\.com\//i },
]

export function tipoDeArquivo(url) {
  const achado = TIPOS_DE_ARQUIVO.find((t) => t.re.test(url || ''))
  return achado ? { tipo: achado.tipo, rotulo: achado.rotulo } : { tipo: 'link', rotulo: 'Link' }
}

// O tipo pelo formato (mimeType) que o Drive informa, que diz mais que o link:
// o link de um PDF enviado é um "drive.google.com/file/..." igual ao de uma
// foto. Sem formato conhecido, vale o link.
const TIPOS_PELO_FORMATO = [
  { re: /^application\/vnd\.google-apps\.document$/, tipo: 'doc', rotulo: 'Documento' },
  { re: /^application\/vnd\.google-apps\.spreadsheet$/, tipo: 'planilha', rotulo: 'Planilha' },
  { re: /^application\/vnd\.google-apps\.presentation$/, tipo: 'apresentacao', rotulo: 'Apresentação' },
  { re: /^application\/vnd\.google-apps\.form$/, tipo: 'formulario', rotulo: 'Formulário' },
  { re: /^application\/vnd\.google-apps\.folder$/, tipo: 'pasta', rotulo: 'Pasta do Drive' },
  { re: /^application\/pdf$/, tipo: 'pdf', rotulo: 'PDF' },
  { re: /wordprocessingml|msword|opendocument\.text/, tipo: 'doc', rotulo: 'Documento do Word' },
  { re: /spreadsheetml|ms-excel|opendocument\.spreadsheet|^text\/csv$/, tipo: 'planilha', rotulo: 'Planilha do Excel' },
  { re: /presentationml|ms-powerpoint|opendocument\.presentation/, tipo: 'apresentacao', rotulo: 'Apresentação do PowerPoint' },
  { re: /^image\//, tipo: 'imagem', rotulo: 'Imagem' },
  { re: /^audio\//, tipo: 'audio', rotulo: 'Áudio' },
  { re: /^video\//, tipo: 'video', rotulo: 'Vídeo' },
  { re: /^text\//, tipo: 'doc', rotulo: 'Texto' },
]

export function tipoDoArquivo(arquivo) {
  const achado = arquivo?.mime && TIPOS_PELO_FORMATO.find((t) => t.re.test(arquivo.mime))
  if (achado) return { tipo: achado.tipo, rotulo: achado.rotulo }
  return tipoDeArquivo(arquivo?.url)
}

// Os arquivos que dá para criar direto no projeto, já na pasta dele.
export const NOVOS_ARQUIVOS = [
  { tipo: 'doc', rotulo: 'Documento', mime: 'application/vnd.google-apps.document' },
  { tipo: 'planilha', rotulo: 'Planilha', mime: 'application/vnd.google-apps.spreadsheet' },
  { tipo: 'apresentacao', rotulo: 'Apresentação', mime: 'application/vnd.google-apps.presentation' },
]

// "2,4 MB", para a lista dizer o tamanho do que foi enviado.
export function tamanhoLegivel(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  const unidades = ['B', 'KB', 'MB', 'GB']
  let valor = bytes
  let i = 0
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024
    i++
  }
  return `${i === 0 ? valor : valor.toLocaleString('pt-BR', { maximumFractionDigits: valor < 10 ? 1 : 0 })} ${unidades[i]}`
}

// Link sem protocolo ("drive.google.com/...") é o que se cola do celular
// muitas vezes; só http(s) passa — "javascript:" num link clicável seria uma
// porta aberta.
export function normalizarLink(texto) {
  const bruto = (texto || '').trim()
  if (!bruto) return null
  const comProtocolo = /^[a-z][a-z0-9+.-]*:/i.test(bruto) ? bruto : `https://${bruto}`
  try {
    const url = new URL(comProtocolo)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}

// Um nome razoável quando a pessoa não escreve nenhum: o nome do arquivo no
// fim do endereço ("contrato.pdf"), ou o tipo + o site ("Documento").
export function nomeSugerido(url) {
  const { tipo, rotulo } = tipoDeArquivo(url)
  if (tipo !== 'link' && tipo !== 'pdf') return rotulo
  try {
    const u = new URL(url)
    const ultimo = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')
    if (ultimo && /\.[a-z0-9]{2,5}$/i.test(ultimo)) return ultimo
    return u.hostname.replace(/^www\./, '')
  } catch {
    return rotulo
  }
}

function normalizarArquivo(a) {
  if (!a || typeof a !== 'object') return null
  const url = normalizarLink(a.url)
  if (!url || typeof a.id !== 'string' || !a.id) return null
  return {
    id: a.id,
    url,
    nome: typeof a.nome === 'string' && a.nome.trim() ? a.nome.trim() : nomeSugerido(url),
    adicionadoEm: typeof a.adicionadoEm === 'string' ? a.adicionadoEm : null,
    // Só os que estão no Drive do projeto (enviados ou criados ali).
    ...(typeof a.driveId === 'string' && a.driveId ? { driveId: a.driveId } : {}),
    ...(typeof a.mime === 'string' && a.mime ? { mime: a.mime } : {}),
    ...(Number.isFinite(a.tamanho) && a.tamanho >= 0 ? { tamanho: a.tamanho } : {}),
  }
}

// O registro do projeto para um arquivo que o Drive acabou de devolver
// (enviado ou criado). O link é o de abrir no Drive/Docs.
export function arquivoDoDrive(f, agora = new Date()) {
  const url = f?.webViewLink || (f?.id ? `https://drive.google.com/file/d/${f.id}/view` : null)
  return normalizarArquivo({
    id: `arq-${agora.getTime().toString(36)}-${(f?.id || '').slice(-6)}`,
    url,
    nome: f?.name,
    adicionadoEm: agora.toISOString(),
    driveId: f?.id,
    mime: f?.mimeType,
    tamanho: f?.size !== undefined ? Number(f.size) : undefined,
  })
}

// Soma arquivos à lista sem repetir o mesmo arquivo do Drive (ou o mesmo link).
export function juntarArquivos(atuais, novos) {
  const lista = normalizarArquivos(atuais)
  for (const novo of (novos || []).filter(Boolean)) {
    const repetido = lista.some((a) => (novo.driveId && a.driveId === novo.driveId) || a.url === novo.url)
    if (!repetido) lista.push(novo)
  }
  return lista
}

// A pasta do projeto no Drive: o id para enviar arquivos e o link para abrir.
export function normalizarPasta(p) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) return null
  const url = normalizarLink(p.url) || `https://drive.google.com/drive/folders/${p.id}`
  return { id: p.id, url }
}

export function normalizarArquivos(lista) {
  return (Array.isArray(lista) ? lista : []).map(normalizarArquivo).filter(Boolean)
}

// Devolve a lista nova, ou null quando o link não é válido. Link repetido
// não duplica: o mesmo arquivo vinculado duas vezes é só ruído na lista.
export function vincularArquivo(arquivos, { url, nome }, agora = new Date()) {
  const link = normalizarLink(url)
  if (!link) return null
  const atuais = normalizarArquivos(arquivos)
  if (atuais.some((a) => a.url === link)) return atuais
  const id = `arq-${agora.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  return [...atuais, { id, url: link, nome: (nome || '').trim() || nomeSugerido(link), adicionadoEm: agora.toISOString() }]
}

export function normalizarProjetos(lista, agora = new Date()) {
  return (Array.isArray(lista) ? lista : []).map((p) => normalizarProjeto(p, agora)).filter(Boolean)
}

// Um nome que não sobra nada depois de virar etiqueta ("!!!") não vira
// projeto: sem id não haveria como ligar tarefa nenhuma a ele.
export function novoProjeto(nome, agora = new Date()) {
  const id = etiqueta(nome)
  if (!id) return null
  const iso = agora.toISOString()
  return { id, nome: nome.trim(), resultado: '', situacao: 'ativo', tipo: 'projeto', prazo: null, createdAt: iso, updatedAt: iso, arquivos: [] }
}

// A ficha de uma etiqueta que ainda não tem ficha: "pops" vira "Pops",
// "caso-maria" vira "Caso maria". Toda etiqueta usada precisa de ficha —
// sem ela o projeto não tem situação, resultado nem pasta, e foi assim que
// um "casos" passou meses sem ninguém saber em que pé estava.
export function fichaParaEtiqueta(id, agora = new Date()) {
  if (typeof id !== 'string' || !id) return null
  const nome = id.replace(/-+/g, ' ').trim()
  const iso = agora.toISOString()
  return normalizarProjeto(
    { id, nome: nome.charAt(0).toUpperCase() + nome.slice(1), situacao: 'ativo', tipo: 'projeto', createdAt: iso, updatedAt: iso },
    agora
  )
}

function maisRecente(...datas) {
  let melhor = null
  for (const d of datas) {
    const t = d ? new Date(d).getTime() : NaN
    if (Number.isFinite(t) && (melhor === null || t > melhor)) melhor = t
  }
  return melhor === null ? null : new Date(melhor).toISOString()
}

// A lista de projetos junta duas fontes: as fichas que existem e as etiquetas
// usadas em tarefas/anotações que ainda não ganharam ficha. Sem a segunda,
// quem já usava #caso-maria antes desta tela existir não veria o projeto
// nenhum até criar a ficha na mão.
export function listarProjetos({ registros = [], tasks = [], notes = [], idProximas }, now = new Date()) {
  const porId = new Map(registros.map((r) => [r.id, { ...r, implicito: false }]))
  const etiquetasSoltas = [...tasks.map((t) => t.projeto), ...notes.map((n) => n.projeto)].filter(Boolean)
  for (const id of etiquetasSoltas) {
    if (!porId.has(id)) {
      porId.set(id, { id, nome: id, resultado: '', situacao: 'ativo', tipo: 'projeto', prazo: null, createdAt: null, updatedAt: null, arquivos: [], implicito: true })
    }
  }

  return [...porId.values()]
    .map((p) => {
      const pendentes = tasks.filter((t) => t.projeto === p.id && t.status !== 'completed')
      const proximaAcao =
        pendentes.filter((t) => idProximas && t.tasklistId === idProximas).sort(compararPorPrioridadeEPrazo)[0] || null
      const anotacoes = notes.filter((n) => n.projeto === p.id)
      return {
        ...p,
        pendentes: pendentes.length,
        atrasadas: pendentes.filter((t) => isOverdueTask(t, now)).length,
        anotacoes: anotacoes.length,
        proximaAcao,
        // Projeto ativo sem próxima ação é o sinal que o GTD mais cobra: ele
        // parou de andar e nada na tela avisa. Pausado e concluído não
        // precisam de próxima ação — é justamente o que os distingue.
        // Rotina também não: ela não anda para uma chegada, só acumula pauta.
        semProximaAcao: p.situacao === 'ativo' && (p.tipo || 'projeto') === 'projeto' && !proximaAcao,
        // "Concluído" com coisa por fazer é uma contradição: ou o projeto não
        // terminou, ou as tarefas ficaram esquecidas. O app só avisa — quem
        // decide qual dos dois é a pessoa.
        concluidoComPendencias: p.situacao === 'concluido' && pendentes.length > 0,
        ultimaAtividade: maisRecente(
          p.updatedAt,
          ...tasks.filter((t) => t.projeto === p.id).map((t) => t.updated),
          ...anotacoes.map((n) => n.updatedAt)
        ),
      }
    })
    .map((p) => ({
      ...p,
      tipo: p.tipo || 'projeto',
      diasSemAtividade: p.ultimaAtividade ? Math.floor((now - new Date(p.ultimaAtividade)) / 86400000) : null,
    }))
    .sort((a, b) => ORDEM_SITUACAO[a.situacao] - ORDEM_SITUACAO[b.situacao] || a.nome.localeCompare(b.nome))
}

// As tarefas de um projeto separadas pelo momento do método em que estão —
// a mesma divisão das listas do Google Tasks, mais as concluídas recentes
// (o histórico do caso, que ajuda a lembrar o que já foi feito).
export function tarefasDoProjeto(tasks, projetoId, { idProximas, idAguardando, idAlgumDia, idEntrada } = {}, maxConcluidas = 10) {
  const doProjeto = (tasks || []).filter((t) => t.projeto === projetoId)
  const pendentes = doProjeto.filter((t) => t.status !== 'completed').sort(compararPorPrioridadeEPrazo)
  const naLista = (id) => (t) => Boolean(id) && t.tasklistId === id
  const listasConhecidas = [idProximas, idAguardando, idAlgumDia, idEntrada].filter(Boolean)
  return {
    proximas: pendentes.filter(naLista(idProximas)),
    aguardando: pendentes.filter(naLista(idAguardando)),
    algumDia: pendentes.filter(naLista(idAlgumDia)),
    entrada: pendentes.filter(naLista(idEntrada)),
    // Tarefas marcadas com o projeto mas em listas de fora do método (as
    // antigas "Prioridade ...") — não somem só por não estarem numa das quatro.
    outras: pendentes.filter((t) => !listasConhecidas.includes(t.tasklistId)),
    concluidas: doProjeto
      .filter((t) => t.status === 'completed')
      .sort((a, b) => new Date(b.completed || 0) - new Date(a.completed || 0))
      .slice(0, maxConcluidas),
  }
}

// Um evento é do projeto pela marca privada (gravada pelo app) ou pela
// etiqueta escrita no título/descrição — para quem cria o compromisso direto
// na Agenda do Google e escreve "#caso-maria" ali mesmo.
export function eventoDoProjeto(event, projetoId) {
  if (!event || !projetoId) return false
  if (event.extendedProperties?.private?.[PROJETO_PROP] === projetoId) return true
  const escapado = projetoId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|\\s)#${escapado}(?![\\w-])`, 'i')
  return re.test(event.summary || '') || re.test(event.description || '')
}

// ---------- panorama: a visão de cima de todos os projetos ----------

// Uma próxima ação com mais que isso costuma ser uma ideia inteira escrita no
// lugar da ação ("Colocar protocolo no app, deve ser possível que cada
// profissional..."). Quem lê não sabe por onde começar — o sinal é o tamanho.
const LIMITE_DE_ACAO = 80

export function pareceIdeia(titulo) {
  return typeof titulo === 'string' && titulo.trim().length > LIMITE_DE_ACAO
}

// Projeto ativo sem mexer há esse tempo está esquecido, mesmo que tenha
// próxima ação: a ação existe, mas ninguém está fazendo.
const DIAS_ESQUECIDO = 14
const DIAS_DE_PRAZO = 14

// O que o painel geral mostra quando nenhum projeto está aberto: cada lista
// é uma pergunta da revisão de projetos do GTD, respondida de olhar. Rotina
// só entra em atrasadas e prazos — "parado", "sem resultado" e "esquecido"
// são perguntas de quem tem chegada.
export function panoramaDosProjetos(lista, tasks = [], now = new Date()) {
  const ativos = (lista || []).filter((p) => p.situacao === 'ativo')
  const projetos = ativos.filter((p) => p.tipo !== 'rotina')
  const hoje = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const limite = new Date(hoje.getTime() + DIAS_DE_PRAZO * 86400000)
  const porId = new Map(ativos.map((p) => [p.id, p]))

  const prazos = []
  for (const p of ativos) {
    if (!p.prazo) continue
    const [a, m, d] = p.prazo.split('-').map(Number)
    const data = new Date(a, m - 1, d)
    if (data >= hoje && data <= limite) prazos.push({ projeto: p, titulo: 'Prazo do projeto', data })
  }
  for (const t of tasks) {
    if (t.status === 'completed' || !t.due || !porId.has(t.projeto)) continue
    const data = new Date(String(t.due).slice(0, 10) + 'T00:00:00')
    if (data >= hoje && data <= limite) prazos.push({ projeto: porId.get(t.projeto), titulo: t.title, data, task: t })
  }
  prazos.sort((x, y) => x.data - y.data)

  return {
    parados: projetos.filter((p) => p.semProximaAcao),
    atrasados: ativos.filter((p) => p.atrasadas > 0),
    prazos,
    semResultado: projetos.filter((p) => !p.resultado?.trim()),
    esquecidos: projetos.filter((p) => !p.semProximaAcao && p.diasSemAtividade !== null && p.diasSemAtividade >= DIAS_ESQUECIDO),
    acaoVaga: projetos.filter((p) => pareceIdeia(p.proximaAcao?.title)),
    // Estes dois olham a lista inteira, e não só os ativos: são justamente
    // os projetos que saíram da vista por estarem marcados como concluídos
    // ou por nunca terem ganhado ficha.
    concluidosComPendencias: (lista || []).filter((p) => p.concluidoComPendencias),
    semFicha: (lista || []).filter((p) => p.implicito),
  }
}

// O que a revisão não deve cobrar como "projeto sem próxima ação": rotinas
// (não têm chegada) e o que está pausado ou concluído (não ter próxima ação é
// o que esses estados significam).
export function projetosForaDaCobranca(lista) {
  return (lista || []).filter((p) => p.tipo === 'rotina' || p.situacao !== 'ativo').map((p) => p.id)
}

// ---------- página do projeto ----------

// "O que já foi feito" num lugar só: tarefas concluídas e compromissos que
// já aconteceram, do mais recente para o mais antigo. Antes os dois ficavam
// em seções separadas e recolhidas, e as concluídas nem apareciam sem o
// "Mostrar concluídas" ligado — abrir o projeto não respondia o que andou.
export function historicoDoProjeto({ concluidas = [], eventosPassados = [] }, eventStart) {
  const itens = [
    ...concluidas
      .filter((t) => t.completed)
      .map((t) => ({ tipo: 'tarefa', id: `t-${t.id}`, titulo: t.title, data: new Date(t.completed), item: t })),
    ...eventosPassados.map((e) => ({
      tipo: 'compromisso',
      id: `e-${e.calendarId}-${e.id}`,
      titulo: e.summary || '(sem título)',
      data: eventStart(e),
      item: e,
    })),
  ]
  return itens.filter((x) => x.data && Number.isFinite(x.data.getTime())).sort((a, b) => b.data - a.data)
}

// Junta as concluídas que vieram com a lista geral (quando "Mostrar
// concluídas" está ligado) às buscadas só para o projeto, sem repetir.
export function juntarConcluidas(...listas) {
  const porId = new Map()
  for (const t of listas.flat()) if (t?.status === 'completed' && !porId.has(t.id)) porId.set(t.id, t)
  return [...porId.values()]
}

// O começo do conteúdo de uma anotação, numa linha corrida: o bastante para
// lembrar o que tem nela sem abrir.
export function trechoDaAnotacao(body, max = 220) {
  const corrido = (body || '').replace(/\s+/g, ' ').trim()
  return corrido.length > max ? `${corrido.slice(0, max).replace(/\s+\S*$/, '')}…` : corrido
}
