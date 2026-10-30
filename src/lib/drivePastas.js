// As pastas dos projetos no Drive visível da pessoa: "Segundo Cérebro" na
// raiz e, dentro dela, uma pasta por projeto. É onde caem os arquivos
// enviados do computador e os documentos criados pelo app — no Drive de
// verdade, para abrir no Docs, compartilhar e achar fora do app também.
//
// A permissão é a drive.file: o app só enxerga o que ele mesmo criou, e não
// o resto do Drive. Por isso a pasta raiz é procurada pelo nome a cada vez
// (a busca só devolve as do próprio app) em vez de guardada.
//
// Recebe o `request` de fora, como googleTarefas e driveArquivos: o mesmo
// código serve ao app e, se um dia precisar, ao conector.

const API = 'https://www.googleapis.com/drive/v3/files'
const PASTA = 'application/vnd.google-apps.folder'
export const NOME_DA_PASTA_RAIZ = 'Segundo Cérebro'
// O que o projeto precisa saber de cada arquivo (ver arquivoDoDrive).
export const CAMPOS_DO_ARQUIVO = 'id,name,mimeType,webViewLink,size'

// A busca do Drive delimita nomes com aspas simples: uma aspa no nome do
// projeto ("D'Ávila") quebraria a consulta sem o escape.
function entreAspas(nome) {
  return `'${nome.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export function criarDriveDosProjetos(request) {
  async function acharOuCriarPasta(nome, paiId) {
    const q = `name = ${entreAspas(nome)} and mimeType = '${PASTA}' and trashed = false and ${entreAspas(paiId)} in parents`
    const achadas = await request(`${API}?${new URLSearchParams({ q, fields: 'files(id,webViewLink)', spaces: 'drive', pageSize: '1' })}`)
    if (achadas?.files?.[0]) return achadas.files[0]
    return request(`${API}?fields=id,webViewLink`, {
      method: 'POST',
      body: JSON.stringify({ name: nome, mimeType: PASTA, parents: [paiId] }),
    })
  }

  // A pasta do projeto: a que ele já tem, se ainda existir fora da lixeira;
  // senão, uma nova. Mandar arquivo para uma pasta na lixeira daria certo,
  // e o arquivo iria junto para a lixeira, sem ninguém perceber.
  async function pastaDoProjeto(projeto) {
    if (projeto.pasta?.id) {
      try {
        const atual = await request(`${API}/${encodeURIComponent(projeto.pasta.id)}?fields=id,trashed,webViewLink`)
        if (atual && !atual.trashed) return { pasta: { id: atual.id, url: atual.webViewLink }, nova: false }
      } catch (err) {
        if (err.status !== 404) throw err
      }
    }
    const raiz = await acharOuCriarPasta(NOME_DA_PASTA_RAIZ, 'root')
    const pasta = await acharOuCriarPasta(projeto.nome || projeto.id, raiz.id)
    return { pasta: { id: pasta.id, url: pasta.webViewLink }, nova: true }
  }

  // Documento, Planilha ou Apresentação do Google, já dentro da pasta.
  function criarArquivoGoogle(pastaId, nome, mime) {
    return request(`${API}?fields=${CAMPOS_DO_ARQUIVO}`, {
      method: 'POST',
      body: JSON.stringify({ name: nome, mimeType: mime, parents: [pastaId] }),
    })
  }

  // Só funciona nos arquivos que o próprio app criou (é o que a permissão
  // drive.file deixa), que são justamente os da pasta do projeto.
  function renomearArquivo(id, nome) {
    return request(`${API}/${encodeURIComponent(id)}?fields=${CAMPOS_DO_ARQUIVO}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: nome }),
    })
  }

  // Lixeira, e não exclusão: o Drive guarda por 30 dias e dá para recuperar
  // de lá. Apagar de vez um documento de um caso por um toque errado não
  // tem volta.
  function mandarParaLixeira(id) {
    return request(`${API}/${encodeURIComponent(id)}?fields=id,trashed`, {
      method: 'PATCH',
      body: JSON.stringify({ trashed: true }),
    })
  }

  // Um Documento do Google já com texto dentro, na pasta. É o jeito de o
  // conector do Claude "anexar" um conteúdo que ele escreveu (uma ata, um
  // rascunho de ofício): ferramenta recebe texto, não arquivo, então o que
  // ele entrega vira um Doc de verdade, editável no Docs. O Drive converte o
  // texto em documento pelo mimeType pedido nos metadados.
  function criarDocumentoComTexto(pastaId, nome, texto) {
    const fronteira = `segundo-cerebro-${Math.random().toString(36).slice(2)}`
    const corpo = [
      `--${fronteira}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({ name: nome, mimeType: 'application/vnd.google-apps.document', parents: [pastaId] }),
      `--${fronteira}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      texto,
      `--${fronteira}--`,
    ].join('\r\n')
    return request(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${CAMPOS_DO_ARQUIVO}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${fronteira}` },
      body: corpo,
    })
  }

  return { pastaDoProjeto, criarArquivoGoogle, renomearArquivo, mandarParaLixeira, criarDocumentoComTexto }
}
