import { normalizarLink } from './projetos.js'

// Os anexos de uma tarefa moram no próprio texto dela, uma linha cada:
//
//   📎 Ofício 12.pdf — https://drive.google.com/file/d/…/view
//
// O Google Tasks não tem campo de anexo, e guardar a lista num arquivo à
// parte do Drive se perderia de vista: a tarefa muda de id quando a conta
// não aceita "mover" (ver moverTarefa), e o anexo precisa ir junto. No texto,
// ele vai — e ainda aparece no app do Google Tasks e para o Claude. A tela
// tira essas linhas do campo de texto e mostra como lista de arquivos.

const LINHA = /^📎\s+(.+?)\s+—\s+(https?:\/\/\S+)\s*$/u
const ID_DO_DRIVE = /\/d\/([\w-]{20,})/
const DOCS_DO_GOOGLE = {
  document: 'application/vnd.google-apps.document',
  spreadsheets: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
  forms: 'application/vnd.google-apps.form',
}

function idCurto(url) {
  let h = 0
  for (const c of url) h = (h * 31 + c.charCodeAt(0)) | 0
  return `anx-${(h >>> 0).toString(36)}`
}

// O que dá para saber de um anexo só pelo link: o id do Drive (para prévia,
// baixar, renomear) e, num link do Docs, que é um documento do Google (que
// não se baixa como arquivo).
export function anexoDoLink(nome, url) {
  const link = normalizarLink(url)
  if (!link) return null
  const anexo = { id: idCurto(link), nome: (nome || '').trim() || link, url: link }
  const doDrive = /^https:\/\/(drive|docs)\.google\.com\//.test(link) && ID_DO_DRIVE.exec(link)
  if (doDrive) anexo.driveId = doDrive[1]
  const doDocs = /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation|forms)\//.exec(link)
  if (doDocs) anexo.mime = DOCS_DO_GOOGLE[doDocs[1]]
  return anexo
}

export function separarAnexos(texto) {
  const anexos = []
  const resto = []
  for (const linha of (texto || '').split('\n')) {
    const m = LINHA.exec(linha.trim())
    const anexo = m && anexoDoLink(m[1], m[2])
    if (anexo) anexos.push(anexo)
    else resto.push(linha)
  }
  return { texto: resto.join('\n').trim(), anexos }
}

// O travessão separa nome e link; um travessão dentro do nome confundiria a
// leitura de volta, então vira hífen.
export function juntarAnexos(texto, anexos) {
  const linhas = (anexos || []).filter((a) => a?.url).map((a) => `📎 ${(a.nome || a.url).replace(/—/g, '-').replace(/\n/g, ' ')} — ${a.url}`)
  const corpo = (texto || '').trim()
  if (!linhas.length) return corpo
  return corpo ? `${corpo}\n\n${linhas.join('\n')}` : linhas.join('\n')
}
