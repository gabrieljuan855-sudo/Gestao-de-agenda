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

async function createFile(notes) {
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
    body: JSON.stringify({ notes }),
  })
}

// Sem nota nenhuma ainda gravada, o arquivo nem existe — não é erro, é só o
// estado normal de quem nunca escreveu nada.
export async function loadNotes() {
  const fileId = await findFileId()
  if (!fileId) return []
  const data = await request(`${DRIVE_BASE}/files/${fileId}?alt=media`)
  return Array.isArray(data?.notes) ? data.notes : []
}

export async function saveNotes(notes) {
  const fileId = await findFileId()
  if (!fileId) {
    await createFile(notes)
    return
  }
  await request(`${UPLOAD_BASE}/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    body: JSON.stringify({ notes }),
  })
}
