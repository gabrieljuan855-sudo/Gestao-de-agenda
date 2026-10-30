// Cada arquivo do app na pasta privada do Drive ("appDataFolder") — um espaço
// que só este app enxerga, que nem aparece no Drive visível do usuário.
//
// A pasta é do *cliente OAuth*, não da conta: só quem entra com o mesmo
// GOOGLE_CLIENT_ID enxerga estes arquivos. É por isso que o conector do Claude
// (worker/conector) usa o mesmo client ID do app, e é por isso que esta
// fábrica recebe o `request` de fora: o app entra com o do navegador, o
// conector com o do Worker, e o caminho até o arquivo é um só.

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3'
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3'
// Cada arquivo do app na pasta privada do Drive (anotações, projetos) segue
// o mesmo ciclo: achar o id uma vez, ler inteiro, gravar inteiro. Guardado em
// memória só para não perguntar "qual é o id do arquivo" ao Drive de novo a
// cada gravação — o id não muda enquanto o arquivo existir.
export function criarArquivoNoDrive(nome, request) {
  let cachedFileId = null

  async function findFileId() {
    if (cachedFileId) return cachedFileId
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      fields: 'files(id)',
      q: `name = '${nome}' and trashed = false`,
    })
    const data = await request(`${DRIVE_BASE}/files?${params}`)
    cachedFileId = data.files?.[0]?.id || null
    return cachedFileId
  }

  // Cria vazio e grava o conteúdo em seguida: o endpoint de metadados não
  // aceita corpo de arquivo junto, e evitar multipart aqui mantém as duas
  // chamadas simples o bastante para reaproveitar o `request()` genérico.
  async function createFile(conteudo) {
    const meta = await request(`${DRIVE_BASE}/files`, {
      method: 'POST',
      body: JSON.stringify({ name: nome, parents: ['appDataFolder'] }),
    })
    cachedFileId = meta.id
    await request(`${UPLOAD_BASE}/files/${meta.id}?uploadType=media`, {
      method: 'PATCH',
      body: conteudo,
    })
  }

  return {
    // `null` quando o arquivo ainda não existe.
    async ler() {
      const fileId = await findFileId()
      if (!fileId) return null
      return request(`${DRIVE_BASE}/files/${fileId}?alt=media`)
    },
    async gravar(conteudo) {
      const fileId = await findFileId()
      if (!fileId) {
        await createFile(conteudo)
        return
      }
      await request(`${UPLOAD_BASE}/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        body: conteudo,
      })
    },
  }
}

// Os dois arquivos do app e o formato de cada um, prontos para quem entrar
// com um `request`. O formato mora aqui, e não em quem chama, para o conector
// do Claude nunca gravar um arquivo que o app não saiba ler.
export function criarArmazemNoDrive(request) {
  const arquivoDeAnotacoes = criarArquivoNoDrive('anotacoes.json', request)
  const arquivoDeProjetos = criarArquivoNoDrive('projetos.json', request)

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
  async function loadNotes() {
    const data = await arquivoDeAnotacoes.ler()
    if (!Array.isArray(data?.notes)) return null
    return { notes: data.notes, deleted: Array.isArray(data.deleted) ? data.deleted : [] }
  }

  async function saveNotes(notes, deleted = []) {
    await arquivoDeAnotacoes.gravar(JSON.stringify({ notes, deleted }))
  }

  // As fichas dos projetos (nome, resultado esperado, situação, prazo). As
  // tarefas de cada projeto não moram aqui — continuam no Google Tasks, ligadas
  // pela etiqueta #projeto; este arquivo guarda só o que o Tasks não tem onde pôr.
  async function loadProjetos() {
    const data = await arquivoDeProjetos.ler()
    return Array.isArray(data?.projetos) ? data.projetos : null
  }

  async function saveProjetos(projetos) {
    await arquivoDeProjetos.gravar(JSON.stringify({ projetos }))
  }

  return { loadNotes, saveNotes, loadProjetos, saveProjetos }
}
