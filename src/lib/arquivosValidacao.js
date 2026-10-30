// O que pode entrar como arquivo de um projeto, de uma tarefa ou de uma nota.
//
// Lista do que é aceito, e não do que é proibido: os arquivos da rotina são
// documentos, planilhas, apresentações, fotos e áudios (relatório, ofício,
// POP, foto de visita, gravação de reunião). Executável, página da web ou
// compactado não têm por que estar ali, e um deles aberto pelo Drive é o
// tipo de coisa que não se quer num lugar com dados de pessoas atendidas.
// Puro: o app usa ao enviar e o conector, ao anexar.

export const TAMANHO_MAXIMO = 100 * 1024 * 1024
// Pré-visualizar baixa o arquivo inteiro para o aparelho; acima disto,
// melhor abrir no Drive do que esperar e gastar dados móveis.
export const TAMANHO_MAXIMO_DA_PREVIA = 30 * 1024 * 1024

const EXTENSOES = {
  documento: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'eml'],
  planilha: ['xls', 'xlsx', 'ods', 'csv'],
  apresentacao: ['ppt', 'pptx', 'odp'],
  imagem: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'],
  audio: ['mp3', 'm4a', 'ogg', 'opus', 'wav', 'aac'],
  video: ['mp4', 'mov', 'm4v', 'webm'],
}
const PERMITIDAS = new Set(Object.values(EXTENSOES).flat())
export const ACEITOS_NO_SELETOR = [...PERMITIDAS].map((e) => `.${e}`).join(',')

export function extensao(nome) {
  const m = /\.([a-z0-9]{1,8})$/i.exec((nome || '').trim())
  return m ? m[1].toLowerCase() : ''
}

function megas(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

// null quando pode; o motivo, em português, quando não pode.
export function motivoDeRecusa({ name, size } = {}) {
  const ext = extensao(name)
  if (!ext) return 'sem extensão no nome, não dá para saber o tipo'
  if (!PERMITIDAS.has(ext)) return `arquivos .${ext} não são aceitos (só documentos, planilhas, apresentações, imagens, áudio e vídeo)`
  if (!Number.isFinite(size) || size <= 0) return 'o arquivo está vazio'
  if (size > TAMANHO_MAXIMO) return `tem ${megas(size)}, acima do limite de ${megas(TAMANHO_MAXIMO)}`
  return null
}

// Separa o que pode subir do que não pode, para enviar os bons e explicar os
// outros numa mensagem só, em vez de recusar a leva inteira por um arquivo.
export function separarArquivos(arquivos) {
  const validos = []
  const recusados = []
  for (const a of arquivos || []) {
    const motivo = motivoDeRecusa(a)
    if (motivo) recusados.push({ nome: a.name || '(sem nome)', motivo })
    else validos.push(a)
  }
  return { validos, recusados }
}

export function mensagemDeRecusa(recusados) {
  if (!recusados.length) return null
  if (recusados.length === 1) return `"${recusados[0].nome}" não foi enviado: ${recusados[0].motivo}.`
  return `${recusados.length} arquivos não foram enviados: ${recusados.map((r) => `"${r.nome}" (${r.motivo})`).join('; ')}.`
}

// Imagem colada (print, foto copiada) chega sempre como "image.png": com
// vários colados, a pasta do projeto viraria uma fila de "image.png".
export function nomeDoColado(nome, tipo, agora = new Date()) {
  const generico = !nome || /^image\.\w+$/i.test(nome)
  if (!generico) return nome
  const ext = extensao(nome) || (tipo?.split('/')[1] || 'png').replace('jpeg', 'jpg')
  const p = (n) => String(n).padStart(2, '0')
  return `Imagem colada ${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())} ${p(agora.getHours())}h${p(agora.getMinutes())}m${p(agora.getSeconds())}s.${ext}`
}

// Renomear sem querer tirar a extensão faria o Drive (e o Windows, depois de
// baixar) não saberem mais abrir o arquivo. Quem quer trocar a extensão
// escreve outra.
export function nomeAoRenomear(novo, antigo) {
  const limpo = (novo || '').trim().replace(/[\\/]/g, '-').slice(0, 200)
  if (!limpo) return null
  const ext = extensao(antigo)
  if (ext && !extensao(limpo)) return `${limpo}.${ext}`
  return limpo
}

// O que dá para mostrar dentro do app: PDF e imagem do próprio Drive, até um
// tamanho razoável. O resto abre no Drive.
export function tipoDePrevia(arquivo) {
  if (!arquivo?.driveId) return null
  if (Number.isFinite(arquivo.tamanho) && arquivo.tamanho > TAMANHO_MAXIMO_DA_PREVIA) return null
  const mime = arquivo.mime || ''
  const ext = extensao(arquivo.nome)
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  // HEIC o navegador (fora do Safari) não desenha.
  if (/^image\/(png|jpe?g|gif|webp)$/.test(mime) || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'imagem'
  return null
}

// Documento, Planilha e Apresentação do Google não são um arquivo para
// baixar como está: só abrem no Docs.
export function podeBaixar(arquivo) {
  return Boolean(arquivo?.driveId) && !/^application\/vnd\.google-apps\./.test(arquivo.mime || '')
}
