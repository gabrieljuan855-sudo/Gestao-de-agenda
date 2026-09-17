// Anotações guardadas na pasta privada do Drive ("appDataFolder") — um
// espaço que só este app enxerga, que nem aparece no Drive visível do
// usuário. Substitui o que antes era um texto solto no localStorage: aqui
// sincroniza entre aparelhos, porque mora na conta do Google, não no
// navegador de um só.
//
// Tudo cabe num arquivo único (anotacoes.json) com a lista inteira de notas:
// para o volume de anotações de uma pessoa (dezenas, não milhares), isso é
// mais simples e mais barato do que um arquivo por nota — uma leitura e uma
// gravação bastam, em vez de uma chamada por nota toda vez que a lista muda.
import { request } from './googleApi.js'

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3'
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3'
const FILE_NAME = 'anotacoes.json'

// Guardado em memória só para não perguntar "qual é o id do arquivo" ao
// Drive de novo a cada gravação — o id não muda enquanto o arquivo existir.
let cachedFileId = null

async function findFileId() {
  if (cachedFileId) return cachedFileId
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    fields: 'files(id)',
    q: `name = '${FILE_NAME}' and trashed = false`,
  })
  const data = await request(`${DRIVE_BASE}/files?${params}`)
  cachedFileId = data.files?.[0]?.id || null
  return cachedFileId
}

async function createFile(conteudo) {
  // Cria vazio e grava o conteúdo em seguida: o endpoint de metadados não
  // aceita corpo de arquivo junto, e evitar multipart aqui mantém as duas
  // chamadas simples o bastante para reaproveitar o `request()` genérico.
  const meta = await request(`${DRIVE_BASE}/files`, {
    method: 'POST',
    body: JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] }),
  })
  cachedFileId = meta.id
  await request(`${UPLOAD_BASE}/files/${meta.id}?uploadType=media`, {
    method: 'PATCH',
    body: conteudo,
  })
}

// O 403 que o Drive devolve quando o token não carrega o escopo
// `drive.appdata`. Acontece com quem entrou no app antes de a sincronização
// existir: o refresh token guardado na sessão congela os escopos do dia em
// que foi autorizado, e nenhum access token tirado dele ganha um escopo
// novo. Não adianta tentar de novo — só um login novo resolve, e é isso que
// a tela precisa dizer, em vez de falar em falha passageira.
export function faltaPermissaoDoDrive(err) {
  if (err?.status !== 403) return false
  return /insufficient|ACCESS_TOKEN_SCOPE/i.test(String(err.body || err.message || ''))
}

// O outro 403 possível, e que não tem nada a ver com login: a API do Drive
// não está ativada no projeto do Google Cloud. O escopo pode estar concedido
// e o token perfeito — a chamada é recusada antes de chegar aos dados, porque
// o projeto nunca habilitou essa API. Calendar e Tasks funcionarem não diz
// nada sobre o Drive: cada API é ativada separadamente, e esta é a primeira
// vez que o app chama o Drive. Nenhum login novo resolve; só o console.
export function driveApiDesativada(err) {
  if (err?.status !== 403) return false
  return /accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(
    String(err.body || err.message || '')
  )
}

// A frase que o próprio Google escreveu para o erro. Sem ela, "erro 403" vira
// um beco sem saída: o código sozinho não distingue API desligada de cota
// estourada, e foi justamente essa ambiguidade que arrastou o diagnóstico.
export function motivoDoGoogle(err) {
  try {
    return JSON.parse(err?.body || '')?.error?.message || ''
  } catch {
    return ''
  }
}

// Devolve `null` quando não há estado utilizável no Drive — o arquivo ainda
// não existe (ninguém gravou nada ainda) ou veio ilegível. Isso é diferente
// de uma lista vazia, que é o arquivo existindo e estando vazio de verdade,
// porque tudo foi apagado. Quem chama precisa da diferença: confundir as duas
// coisas faz o "ainda não sincronizou" apagar as anotações que só existem no
// aparelho.
//
// `deleted` são os rastros de exclusão (ver notesMerge.js). Arquivos gravados
// antes de eles existirem não têm o campo, e uma lista vazia é a leitura certa
// para esse caso — ninguém apagou nada que precise ser lembrado.
export async function loadNotes() {
  const fileId = await findFileId()
  if (!fileId) return null
  const data = await request(`${DRIVE_BASE}/files/${fileId}?alt=media`)
  if (!Array.isArray(data?.notes)) return null
  return { notes: data.notes, deleted: Array.isArray(data.deleted) ? data.deleted : [] }
}

export async function saveNotes(notes, deleted = []) {
  const conteudo = JSON.stringify({ notes, deleted })
  const fileId = await findFileId()
  if (!fileId) {
    await createFile(conteudo)
    return
  }
  await request(`${UPLOAD_BASE}/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    body: conteudo,
  })
}
