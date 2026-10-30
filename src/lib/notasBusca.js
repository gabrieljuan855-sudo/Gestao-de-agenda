import { semAcento } from './texto.js'

// Busca nas anotações por palavras, com ranking — o "perguntar à base" do
// claude-obsidian. Antes a busca era um trecho exato: "editais para PSR" só
// achava a nota que tivesse essas três palavras juntas, nessa ordem, e o
// Claude respondia "não achei nada" com a resposta guardada logo ali.
//
// Agora cada palavra conta sozinha, e a ordem vem do BM25 (o mesmo cálculo
// dos buscadores): palavra rara pesa mais que palavra comum, título pesa mais
// que texto, e nota comprida não ganha só por ser comprida. A mesma função
// serve ao app (a busca da lista) e ao conector (buscar_notas), para os dois
// acharem a mesma coisa.

// Palavras que aparecem em quase toda frase e não dizem do que a nota trata.
const PALAVRAS_VAZIAS = new Set(
  (
    'a o e as os um uma uns umas de do da dos das em no na nos nas ao aos à às ' +
    'por pelo pela pelos pelas para pra com sem que se ou mas como mais menos ' +
    'muito muita ja já nao não sim é ser foi era sao são ter tem tinha ' +
    'eu ele ela eles elas voce você isso isto esse essa este esta aquele aquela ' +
    'me te lhe meu minha seu sua nosso nossa sobre entre ate até quando onde ' +
    'qual quais quem o que'
  )
    .split(/\s+/)
    .map(semAcento)
)

// Título vale por três ocorrências: "Caso Silva" no título diz mais sobre a
// nota do que uma menção solta no meio do texto.
const PESO_DO_TITULO = 3
const K1 = 1.2
const B = 0.75

// Um radical bem simples para o português: junta singular e plural ("edital"
// e "editais", "ação" e "ações") e corta a palavra em seis letras, para
// "família"/"familiar" ou "recurso"/"recursos" se acharem. Erra às vezes
// ("popular" cai junto de "população"), mas numa base pessoal achar a mais é
// melhor que não achar — o ranking põe o melhor em cima.
export function radical(palavra) {
  let p = semAcento(palavra)
  if (p.length > 4) {
    p = p
      .replace(/(oes|aes|aos)$/, 'ao')
      .replace(/([aeou])is$/, '$1l')
      .replace(/ns$/, 'm')
  }
  if (p.length > 3 && p.endsWith('s')) p = p.slice(0, -1)
  return p.slice(0, 6)
}

function palavrasDe(texto) {
  return semAcento(texto || '').match(/[\p{L}\p{N}]+/gu) || []
}

// Os termos de uma busca, sem repetir. Se a busca só tiver palavras vazias
// ("de", "o que"), elas mesmas valem — senão a busca não acharia nada.
export function termosDaBusca(consulta) {
  const palavras = palavrasDe(consulta)
  const uteis = palavras.filter((p) => !PALAVRAS_VAZIAS.has(p))
  return [...new Set((uteis.length ? uteis : palavras).map(radical))]
}

function radicaisDe(texto) {
  return palavrasDe(texto)
    .filter((p) => !PALAVRAS_VAZIAS.has(p))
    .map(radical)
}

function textoDasFontes(nota) {
  return (nota.fontes || []).map((f) => [f.titulo, f.autor].filter(Boolean).join(' ')).join('\n')
}

// Os radicais da nota, com o título repetido pelo peso dele. Título vazio usa
// a primeira linha do texto, como a lista mostra (tituloDaNota) — e essa linha
// já está no corpo, então não entra de novo.
function indexar(nota) {
  const titulo = radicaisDe(nota.title)
  const corpo = [...radicaisDe(nota.body), ...radicaisDe(textoDasFontes(nota))]
  const tokens = [...corpo]
  for (let i = 0; i < PESO_DO_TITULO; i++) tokens.push(...titulo)
  return tokens
}

// O termo casa com o começo do radical: quem digita "sil" já acha "Silva",
// e a lista do app vai filtrando enquanto se digita.
const casa = (token, termo) => token.startsWith(termo)

// As notas que têm pelo menos uma das palavras, da mais relevante para a
// menos; empate fica com a editada por último.
export function buscarNasNotas(notas, consulta, { limite = Infinity } = {}) {
  const termos = termosDaBusca(consulta)
  const lista = notas || []
  if (!termos.length || !lista.length) return []
  const docs = lista.map((nota) => ({ nota, tokens: indexar(nota) }))
  const mediaDeTamanho = docs.reduce((s, d) => s + d.tokens.length, 0) / docs.length || 1

  const idf = new Map(
    termos.map((termo) => {
      const df = docs.filter((d) => d.tokens.some((t) => casa(t, termo))).length
      return [termo, Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))]
    })
  )

  return docs
    .map(({ nota, tokens }) => {
      let pontos = 0
      for (const termo of termos) {
        const tf = tokens.filter((t) => casa(t, termo)).length
        if (!tf) continue
        pontos += idf.get(termo) * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * tokens.length) / mediaDeTamanho)))
      }
      return { nota, pontos }
    })
    .filter((r) => r.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos || new Date(b.nota.updatedAt) - new Date(a.nota.updatedAt))
    .slice(0, limite)
}

// Para a lista do app, que filtra enquanto se digita: a nota precisa ter todas
// as palavras (cada uma em qualquer lugar), como a busca do Notas do iPhone.
export function combinaComABusca(nota, consulta) {
  const termos = termosDaBusca(consulta)
  if (!termos.length) return true
  const tokens = indexar(nota)
  return termos.every((termo) => tokens.some((t) => casa(t, termo)))
}

// Um trecho do texto em volta da primeira palavra da busca, para mostrar por
// que a nota apareceu. A comparação é sem acento, mas o trecho sai com o
// texto original — por isso a normalização é feita letra a letra, mantendo a
// posição de cada uma.
export function trechoDaBusca(texto, consulta, tamanho = 160) {
  const original = (texto || '').replace(/\s+/g, ' ').trim()
  if (!original) return ''
  const normalizado = original
    .split('')
    .map((c) => semAcento(c)[0] || c)
    .join('')
  const termos = termosDaBusca(consulta)
  let inicio = -1
  for (const m of normalizado.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (!PALAVRAS_VAZIAS.has(m[0]) && termos.some((termo) => radical(m[0]).startsWith(termo))) {
      inicio = m.index
      break
    }
  }
  if (inicio < 0 || original.length <= tamanho) return original.length <= tamanho ? original : `${original.slice(0, tamanho).trimEnd()}…`
  const de = Math.max(0, inicio - Math.floor(tamanho / 3))
  const ate = Math.min(original.length, de + tamanho)
  return `${de > 0 ? '…' : ''}${original.slice(de, ate).trim()}${ate < original.length ? '…' : ''}`
}
