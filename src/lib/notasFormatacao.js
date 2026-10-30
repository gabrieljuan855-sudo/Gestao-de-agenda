// A formatação das anotações: títulos, listas, checklist, negrito, itálico...
// do jeito do Notas do iPhone, mas guardada como texto com marcação (o
// Markdown de sempre: "# ", "- [ ] ", "**negrito**").
//
// Por que texto e não HTML: a nota é a mesma no app, no conector do Claude,
// na busca e nos [[links]] — todos leem o `body` como texto. O Claude já
// escreve "- [ ] item" naturalmente, a busca por palavras ignora os
// símbolos, e uma nota antiga continua sendo uma nota válida. Formatar vira
// só uma forma de mostrar o mesmo texto.
//
// Tudo aqui é puro (texto entra, texto e seleção saem), para ser testado
// sem navegador; o Notes.jsx só aplica o resultado no campo de texto.

// Marcadores de lista aceitos na leitura. O "–" entra porque o iPhone troca o
// hífen por ele em alguns teclados; o travessão longo não, porque é
// pontuação comum de frase ("— disse ele") e viraria lista sem querer.
const MARCADOR = '[-*+•–]'
const RE_DIVISOR = /^(?:-{3,}|\*{3,}|_{3,})\s*$/
const RE_TITULO = /^(#{1,3})\s+(.*)$/
const RE_TAREFA = new RegExp(`^(?:(${MARCADOR})\\s+)?\\[([ xX])\\](?:\\s+|$)(.*)$`)
const RE_MARCADOR = new RegExp(`^(${MARCADOR})\\s+(.*)$`)
const RE_NUMERADA = /^(\d{1,4})([.)])\s+(.*)$/
const RE_CITACAO = /^>\s?(.*)$/

const TITULOS = ['titulo', 'subtitulo', 'cabecalho']
const LISTAS = new Set(['tarefa', 'marcador', 'numerada', 'citacao'])
// Um nível de recuo são dois espaços (ou um tab, que é como chega colado de
// outros editores).
const RECUO = '  '

function nivelDoRecuo(recuo) {
  let espacos = 0
  for (const c of recuo) espacos += c === '\t' ? 2 : 1
  return Math.floor(espacos / 2)
}

// O que uma linha é. `inicio` é onde começa o conteúdo dentro da linha — o
// que vem antes é marcação (recuo, "# ", "- [ ] ").
export function analisarLinha(linha) {
  const recuo = linha.match(/^[ \t]*/)[0]
  const resto = linha.slice(recuo.length)
  const base = { recuo, nivel: nivelDoRecuo(recuo) }
  const com = (tipo, conteudo, extra = {}) => ({ ...base, tipo, conteudo, inicio: linha.length - conteudo.length, ...extra })
  let m
  if (!resto.trim()) return { ...base, tipo: 'vazia', conteudo: '', inicio: linha.length }
  if (RE_DIVISOR.test(resto)) return com('divisor', '')
  if ((m = resto.match(RE_TITULO))) return com(TITULOS[m[1].length - 1], m[2])
  if ((m = resto.match(RE_TAREFA))) return com('tarefa', m[3], { marcado: m[2] !== ' ', marcador: m[1] || '-' })
  if ((m = resto.match(RE_MARCADOR))) return com('marcador', m[2], { marcador: m[1] })
  if ((m = resto.match(RE_NUMERADA))) return com('numerada', m[3], { numero: Number(m[1]), separador: m[2] })
  if ((m = resto.match(RE_CITACAO))) return com('citacao', m[1])
  return com('texto', resto)
}

// As linhas do texto com a posição de cada uma, para a tela saber onde pôr
// o cursor ao tocar numa linha e qual linha marcar ao tocar num círculo.
export function linhasDoTexto(texto) {
  const linhas = []
  let pos = 0
  for (const [indice, linha] of (texto || '').split('\n').entries()) {
    linhas.push({ indice, de: pos, ate: pos + linha.length, texto: linha, ...analisarLinha(linha) })
    pos += linha.length + 1
  }
  return linhas
}

// As linhas que uma seleção toca. Seleção que termina bem no começo de uma
// linha não a inclui — é o que acontece ao selecionar linhas inteiras.
function linhasDaSelecao(linhas, ini, fim) {
  return linhas.filter((l) => {
    if (fim > ini && fim === l.de && l.de > ini) return false
    return l.ate >= ini && l.de <= fim
  })
}

function juntar(linhas) {
  return linhas.map((l) => l.texto).join('\n')
}

function prefixo(estilo, info, numero) {
  switch (estilo) {
    case 'titulo': return '# '
    case 'subtitulo': return '## '
    case 'cabecalho': return '### '
    case 'tarefa': return `${info.recuo}- [${info.tipo === 'tarefa' && info.marcado ? 'x' : ' '}] `
    case 'marcador': return `${info.recuo}- `
    case 'numerada': return `${info.recuo}${numero}. `
    case 'citacao': return '> '
    default: return LISTAS.has(info.tipo) ? info.recuo : ''
  }
}

// Título, subtítulo, lista, checklist... nas linhas da seleção. Aplicar um
// estilo que todas as linhas já têm volta para o corpo de texto, como o
// botão de checklist do iPhone, que liga e desliga.
export function aplicarEstilo(texto, ini, fim, estilo) {
  const linhas = linhasDoTexto(texto)
  const alvo = linhasDaSelecao(linhas, ini, fim)
  // Em várias linhas, as vazias ficam como estão (são o espaço entre os
  // blocos); numa linha só, a vazia é justamente onde a lista vai começar.
  const afetadas = alvo.length > 1 ? alvo.filter((l) => l.tipo !== 'vazia') : alvo
  if (!afetadas.length) return { texto, ini, fim }
  const final = afetadas.every((l) => l.tipo === estilo) ? 'corpo' : estilo

  // Numerada continua a contagem de uma lista logo acima, no mesmo nível.
  const anterior = linhas[afetadas[0].indice - 1]
  let numero = anterior?.tipo === 'numerada' && anterior.nivel === afetadas[0].nivel ? anterior.numero + 1 : 1

  const primeira = afetadas[0]
  const ultima = afetadas[afetadas.length - 1]
  let deslocIni = 0
  for (const l of afetadas) {
    const novoPrefixo = prefixo(final, l, numero)
    if (final === 'numerada') numero += 1
    const novo = novoPrefixo + l.conteudo
    if (l === primeira) deslocIni = novoPrefixo.length - l.inicio
    linhas[l.indice] = { ...l, texto: novo }
  }
  const novoTexto = juntar(linhas)
  if (ini === fim && afetadas.length === 1) {
    const cursor = Math.max(primeira.de + linhas[primeira.indice].texto.length - primeira.conteudo.length, ini + deslocIni)
    return { texto: novoTexto, ini: cursor, fim: cursor }
  }
  const novas = linhasDoTexto(novoTexto)
  return { texto: novoTexto, ini: novas[primeira.indice].de, fim: novas[ultima.indice].ate }
}

// O estilo da linha onde está o cursor, para a barra mostrar qual botão está
// ligado.
export function estiloNaPosicao(texto, pos) {
  const linha = linhasDoTexto(texto).find((l) => pos >= l.de && pos <= l.ate)
  return linha ? linha.tipo : 'texto'
}

// Negrito, itálico, riscado e código em volta da seleção. Sem seleção, abre o
// par e deixa o cursor no meio, para já sair digitando formatado. Aplicar de
// novo onde já está formatado tira a formatação.
export function alternarMarca(texto, ini, fim, marca) {
  const n = marca.length
  if (ini === fim) {
    if (texto.slice(ini - n, ini) === marca && texto.slice(ini, ini + n) === marca) {
      return { texto: texto.slice(0, ini - n) + texto.slice(ini + n), ini: ini - n, fim: ini - n }
    }
    return { texto: texto.slice(0, ini) + marca + marca + texto.slice(ini), ini: ini + n, fim: ini + n }
  }
  // O espaço que vem junto ao selecionar uma palavra com duplo clique fica
  // de fora: "**palavra **" não vira negrito.
  let a = ini
  let b = fim
  while (a < b && /\s/.test(texto[a])) a++
  while (b > a && /\s/.test(texto[b - 1])) b--
  if (a === b) return { texto, ini, fim }
  const meio = texto.slice(a, b)
  if (meio.length >= 2 * n && meio.startsWith(marca) && meio.endsWith(marca)) {
    const sem = meio.slice(n, -n)
    return { texto: texto.slice(0, a) + sem + texto.slice(b), ini: a, fim: a + sem.length }
  }
  if (texto.slice(a - n, a) === marca && texto.slice(b, b + n) === marca) {
    return { texto: texto.slice(0, a - n) + meio + texto.slice(b + n), ini: a - n, fim: b - n }
  }
  return { texto: texto.slice(0, a) + marca + meio + marca + texto.slice(b), ini: a + n, fim: b + n }
}

// Recuo das linhas da seleção, para montar sublistas (Tab e Shift+Tab).
export function recuar(texto, ini, fim, direcao) {
  const linhas = linhasDoTexto(texto)
  const alvo = linhasDaSelecao(linhas, ini, fim)
  let deslocIni = 0
  let deslocTotal = 0
  for (const l of alvo) {
    let novo
    if (direcao > 0) novo = RECUO + l.texto
    else if (l.texto.startsWith('\t')) novo = l.texto.slice(1)
    else novo = l.texto.replace(/^ {1,2}/, '')
    const delta = novo.length - l.texto.length
    if (l === alvo[0]) deslocIni = Math.max(delta, l.de - ini)
    deslocTotal += delta
    linhas[l.indice] = { ...l, texto: novo }
  }
  return { texto: juntar(linhas), ini: ini + deslocIni, fim: fim + deslocTotal }
}

// O Enter dentro de uma lista: o item seguinte já nasce com o marcador (o
// círculo vazio na checklist, o número seguinte na numerada). Enter num item
// vazio encerra a lista — ou, se ele está recuado, sobe um nível —, como no
// Notas. Devolve null quando o Enter é um Enter comum.
export function quebrarLinha(texto, ini, fim) {
  if (ini !== fim) return null
  const linha = linhasDoTexto(texto).find((l) => ini >= l.de && ini <= l.ate)
  if (!linha || !LISTAS.has(linha.tipo)) return null
  if (ini < linha.de + linha.inicio) return null

  if (!linha.conteudo.trim()) {
    if (linha.nivel > 0) return recuar(texto, ini, fim, -1)
    const texto2 = texto.slice(0, linha.de) + texto.slice(linha.ate)
    return { texto: texto2, ini: linha.de, fim: linha.de }
  }

  let novo
  if (linha.tipo === 'tarefa') novo = `${linha.recuo}${linha.marcador} [ ] `
  else if (linha.tipo === 'marcador') novo = `${linha.recuo}${linha.marcador} `
  else if (linha.tipo === 'numerada') novo = `${linha.recuo}${linha.numero + 1}${linha.separador} `
  else novo = '> '
  const inserido = '\n' + novo
  const cursor = ini + inserido.length
  return { texto: texto.slice(0, ini) + inserido + texto.slice(ini), ini: cursor, fim: cursor }
}

// Marca ou desmarca o item da checklist na linha dada (o toque no círculo).
export function alternarTarefa(texto, indiceDaLinha) {
  const linhas = linhasDoTexto(texto)
  const l = linhas[indiceDaLinha]
  if (!l || l.tipo !== 'tarefa') return texto
  const colchete = l.texto.indexOf('[', l.recuo.length)
  const novo = l.texto.slice(0, colchete + 1) + (l.marcado ? ' ' : 'x') + l.texto.slice(colchete + 2)
  linhas[indiceDaLinha] = { ...l, texto: novo }
  return juntar(linhas)
}

export function progressoDasTarefas(texto) {
  const tarefas = linhasDoTexto(texto).filter((l) => l.tipo === 'tarefa')
  return { feitas: tarefas.filter((l) => l.marcado).length, total: tarefas.length }
}

export function desmarcarTodas(texto) {
  const linhas = linhasDoTexto(texto)
  return juntar(linhas.map((l) => (l.tipo === 'tarefa' && l.marcado ? { ...l, texto: alternarTarefa(l.texto, 0) } : l)))
}

// "Mover marcados para o fim", do Notas: dentro de cada checklist (linhas de
// tarefa seguidas), o que já foi feito desce e o que falta sobe, sem mudar a
// ordem entre os que falta. O item vai junto com os subitens dele — senão o
// subitem ficava para trás, pendurado no item de cima. O que não é tarefa
// fica onde está.
export function marcadasParaOFim(texto) {
  const linhas = linhasDoTexto(texto)
  const saida = []
  let bloco = []
  const fechar = () => {
    const base = Math.min(...bloco.map((l) => l.nivel))
    const grupos = []
    for (const l of bloco) {
      if (!grupos.length || l.nivel <= base) grupos.push([l])
      else grupos[grupos.length - 1].push(l)
    }
    const ordem = [...grupos.filter((g) => !g[0].marcado), ...grupos.filter((g) => g[0].marcado)]
    saida.push(...ordem.flat())
    bloco = []
  }
  for (const l of linhas) {
    if (l.tipo === 'tarefa') bloco.push(l)
    else {
      fechar()
      saida.push(l)
    }
  }
  fechar()
  return juntar(saida)
}

// ---- formatação dentro da linha ----

// A ordem importa: código primeiro (dentro dele nada é marcação), depois os
// [[links]], que podem ter qualquer coisa no título.
const INLINE = new RegExp(
  [
    '(`[^`\\n]+`)',
    '(\\[\\[[^[\\]\\n]+?\\]\\])',
    '(\\*\\*(?=\\S)[^\\n]*?\\S\\*\\*)',
    '(~~(?=\\S)[^\\n]*?\\S~~)',
    '(\\*(?=[^\\s*])[^*\\n]*?[^\\s*]\\*)',
    '(_(?=[^\\s_])[^_\\n]*?[^\\s_]_)',
    '(\\[[^\\]\\n]+\\]\\(https?:\\/\\/[^\\s)]+\\))',
    '(https?:\\/\\/[^\\s<]+[^\\s<.,;:!?)\\]\'"])',
  ].join('|'),
  'g'
)
const LETRA = /[\p{L}\p{N}_]/u

// O texto de uma linha em pedaços para a tela: texto comum, negrito,
// itálico, riscado, código, [[link]] e endereço da web. Negrito e cia. têm
// filhos, porque **negrito com _itálico_ dentro** existe. Link só http(s):
// um "javascript:" clicável seria uma porta aberta.
export function segmentosDaLinha(texto) {
  const partes = []
  let ultimo = 0
  const re = new RegExp(INLINE.source, 'g')
  let m
  while ((m = re.exec(texto))) {
    const [todo, codigo, link, negrito, riscado, italico, sublinhado, mdLink, url] = m
    // _assim_ só vale fora de palavras: nome_de_arquivo não é itálico.
    if (sublinhado && ((m.index > 0 && LETRA.test(texto[m.index - 1])) || LETRA.test(texto[m.index + todo.length] || ''))) {
      re.lastIndex = m.index + 1
      continue
    }
    if (m.index > ultimo) partes.push({ tipo: 'texto', texto: texto.slice(ultimo, m.index) })
    if (codigo) partes.push({ tipo: 'codigo', texto: codigo.slice(1, -1) })
    else if (link) {
      const [alvo, apelido] = link.slice(2, -2).split('|')
      partes.push({ tipo: 'link', alvo: alvo.split('#')[0].trim(), texto: (apelido ?? alvo.split('#')[0]).trim() })
    } else if (negrito) partes.push({ tipo: 'negrito', filhos: segmentosDaLinha(negrito.slice(2, -2)) })
    else if (riscado) partes.push({ tipo: 'riscado', filhos: segmentosDaLinha(riscado.slice(2, -2)) })
    else if (italico || sublinhado) partes.push({ tipo: 'italico', filhos: segmentosDaLinha((italico || sublinhado).slice(1, -1)) })
    else if (mdLink) {
      const fecha = mdLink.indexOf('](')
      partes.push({ tipo: 'url', texto: mdLink.slice(1, fecha), url: mdLink.slice(fecha + 2, -1) })
    } else if (url) partes.push({ tipo: 'url', texto: url, url })
    ultimo = m.index + todo.length
  }
  if (ultimo < texto.length) partes.push({ tipo: 'texto', texto: texto.slice(ultimo) })
  return partes
}

function semFormatoNaLinha(partes) {
  return partes.map((p) => (p.filhos ? semFormatoNaLinha(p.filhos) : p.texto)).join('')
}

// A linha como se lê, sem marcação nenhuma: "- [ ] **Pão**" vira "Pão". Para
// as prévias da lista e da página do projeto.
export function linhaSemFormato(linha) {
  const info = analisarLinha(linha)
  if (info.tipo === 'divisor') return ''
  return semFormatoNaLinha(segmentosDaLinha(info.conteudo)).trim()
}

export function textoSemFormato(texto) {
  return (texto || '').split('\n').map(linhaSemFormato).filter(Boolean).join(' ')
}
