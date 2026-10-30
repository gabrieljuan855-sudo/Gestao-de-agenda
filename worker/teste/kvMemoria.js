// Um KV da Cloudflare em memória, com o pedaço da API que a biblioteca de
// OAuth usa (get, put, delete, list). Só para testes.
export function kvEmMemoria() {
  const dados = new Map()
  return {
    dados,
    async get(chave, opcoes) {
      const item = dados.get(chave)
      if (!item) return null
      const tipo = typeof opcoes === 'string' ? opcoes : opcoes?.type
      return tipo === 'json' ? JSON.parse(item.valor) : item.valor
    },
    async getWithMetadata(chave, opcoes) {
      const item = dados.get(chave)
      return { value: item ? await this.get(chave, opcoes) : null, metadata: item?.metadata ?? null }
    },
    async put(chave, valor, opcoes = {}) {
      dados.set(chave, { valor: typeof valor === 'string' ? valor : JSON.stringify(valor), metadata: opcoes.metadata ?? null })
    },
    async delete(chave) {
      dados.delete(chave)
    },
    async list({ prefix = '' } = {}) {
      const keys = [...dados.entries()]
        .filter(([nome]) => nome.startsWith(prefix))
        .map(([name, item]) => ({ name, metadata: item.metadata }))
      return { keys, list_complete: true, cursor: undefined }
    },
  }
}
