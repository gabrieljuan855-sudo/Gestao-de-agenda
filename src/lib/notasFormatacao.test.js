import { describe, it, expect } from 'vitest'
import {
  analisarLinha,
  aplicarEstilo,
  estiloNaPosicao,
  alternarMarca,
  recuar,
  quebrarLinha,
  alternarTarefa,
  progressoDasTarefas,
  desmarcarTodas,
  marcadasParaOFim,
  segmentosDaLinha,
  linhaSemFormato,
  textoSemFormato,
} from './notasFormatacao.js'

describe('analisarLinha', () => {
  it('reconhece cada tipo de linha', () => {
    expect(analisarLinha('# Compras').tipo).toBe('titulo')
    expect(analisarLinha('## Loja').tipo).toBe('subtitulo')
    expect(analisarLinha('### Seção').tipo).toBe('cabecalho')
    expect(analisarLinha('- [ ] Pão')).toMatchObject({ tipo: 'tarefa', marcado: false, conteudo: 'Pão' })
    expect(analisarLinha('- [x] Pão')).toMatchObject({ tipo: 'tarefa', marcado: true })
    expect(analisarLinha('[X] Pão')).toMatchObject({ tipo: 'tarefa', marcado: true, conteudo: 'Pão' })
    expect(analisarLinha('- Pão')).toMatchObject({ tipo: 'marcador', conteudo: 'Pão' })
    expect(analisarLinha('3. Pão')).toMatchObject({ tipo: 'numerada', numero: 3, conteudo: 'Pão' })
    expect(analisarLinha('> dito')).toMatchObject({ tipo: 'citacao', conteudo: 'dito' })
    expect(analisarLinha('---').tipo).toBe('divisor')
    expect(analisarLinha('   ').tipo).toBe('vazia')
    expect(analisarLinha('Texto comum').tipo).toBe('texto')
  })

  it('aceita o "–" que o teclado do iPhone põe no lugar do hífen', () => {
    expect(analisarLinha('– [ ] Carregador por indução')).toMatchObject({ tipo: 'tarefa', conteudo: 'Carregador por indução' })
  })

  it('não confunde texto comum com lista', () => {
    expect(analisarLinha('-5 graus hoje').tipo).toBe('texto')
    expect(analisarLinha('— disse ele').tipo).toBe('texto')
    expect(analisarLinha('#hashtag').tipo).toBe('texto')
  })

  it('mede o recuo em níveis de dois espaços', () => {
    expect(analisarLinha('    - item')).toMatchObject({ tipo: 'marcador', nivel: 2 })
    expect(analisarLinha('\t- item').nivel).toBe(1)
  })
})

describe('aplicarEstilo', () => {
  it('transforma a linha do cursor em item da checklist, com o cursor depois do círculo', () => {
    const r = aplicarEstilo('Pão', 3, 3, 'tarefa')
    expect(r.texto).toBe('- [ ] Pão')
    expect(r.ini).toBe(9)
  })

  it('começa uma checklist numa linha vazia', () => {
    const r = aplicarEstilo('Lista\n', 6, 6, 'tarefa')
    expect(r.texto).toBe('Lista\n- [ ] ')
    expect(r.ini).toBe(12)
  })

  it('aplicar o mesmo estilo de novo volta para o texto', () => {
    expect(aplicarEstilo('- [ ] Pão', 9, 9, 'tarefa').texto).toBe('Pão')
    expect(aplicarEstilo('# Título', 3, 3, 'titulo').texto).toBe('Título')
  })

  it('troca um estilo pelo outro sem empilhar marcação', () => {
    expect(aplicarEstilo('- Pão', 5, 5, 'tarefa').texto).toBe('- [ ] Pão')
    expect(aplicarEstilo('- [x] Pão', 5, 5, 'titulo').texto).toBe('# Pão')
  })

  it('numera várias linhas em sequência, pulando as vazias', () => {
    const texto = 'Pão\nLeite\n\nOvos'
    const r = aplicarEstilo(texto, 0, texto.length, 'numerada')
    expect(r.texto).toBe('1. Pão\n2. Leite\n\n3. Ovos')
  })

  it('continua a numeração de uma lista logo acima', () => {
    expect(aplicarEstilo('1. Pão\nLeite', 9, 9, 'numerada').texto).toBe('1. Pão\n2. Leite')
  })

  it('mantém o recuo ao trocar de lista e mantém marcado o que estava', () => {
    expect(aplicarEstilo('  - Pão', 6, 6, 'tarefa').texto).toBe('  - [ ] Pão')
    expect(aplicarEstilo('- [x] Pão', 6, 6, 'marcador').texto).toBe('- Pão')
  })

  it('seleção que termina no começo de uma linha não a inclui', () => {
    const texto = 'Pão\nLeite'
    expect(aplicarEstilo(texto, 0, 4, 'marcador').texto).toBe('- Pão\nLeite')
  })
})

describe('estiloNaPosicao', () => {
  it('diz o estilo da linha onde está o cursor', () => {
    expect(estiloNaPosicao('Pão\n- [ ] Leite', 8)).toBe('tarefa')
    expect(estiloNaPosicao('Pão\n- [ ] Leite', 1)).toBe('texto')
  })
})

describe('alternarMarca', () => {
  it('põe e tira negrito em volta da seleção', () => {
    const r = alternarMarca('um dois três', 3, 7, '**')
    expect(r).toEqual({ texto: 'um **dois** três', ini: 5, fim: 9 })
    expect(alternarMarca(r.texto, r.ini, r.fim, '**').texto).toBe('um dois três')
  })

  it('tira também quando a seleção inclui as marcas', () => {
    expect(alternarMarca('um **dois** três', 3, 11, '**').texto).toBe('um dois três')
  })

  it('deixa de fora o espaço que vem junto na seleção', () => {
    expect(alternarMarca('um dois três', 3, 8, '_').texto).toBe('um _dois_ três')
  })

  it('sem seleção, abre o par com o cursor no meio; de novo, fecha', () => {
    const r = alternarMarca('ab', 1, 1, '~~')
    expect(r).toEqual({ texto: 'a~~~~b', ini: 3, fim: 3 })
    expect(alternarMarca(r.texto, r.ini, r.fim, '~~')).toEqual({ texto: 'ab', ini: 1, fim: 1 })
  })
})

describe('recuar', () => {
  it('recua e desfaz o recuo das linhas da seleção', () => {
    const r = recuar('- a\n- b', 0, 7, 1)
    expect(r.texto).toBe('  - a\n  - b')
    expect(recuar(r.texto, r.ini, r.fim, -1).texto).toBe('- a\n- b')
  })

  it('não leva o cursor para antes da linha ao desfazer o recuo', () => {
    const r = recuar('x\n  - b', 3, 3, -1)
    expect(r.texto).toBe('x\n- b')
    expect(r.ini).toBe(2)
  })
})

describe('quebrarLinha', () => {
  it('o próximo item da checklist já nasce com o círculo vazio', () => {
    const texto = '- [x] Pão'
    const r = quebrarLinha(texto, texto.length, texto.length)
    expect(r.texto).toBe('- [x] Pão\n- [ ] ')
    expect(r.ini).toBe(r.texto.length)
  })

  it('mantém o marcador que a lista usa e numera em sequência', () => {
    expect(quebrarLinha('– Pão', 5, 5).texto).toBe('– Pão\n– ')
    expect(quebrarLinha('1) Pão', 6, 6).texto).toBe('1) Pão\n2) ')
    expect(quebrarLinha('  - Pão', 7, 7).texto).toBe('  - Pão\n  - ')
  })

  it('divide o item quando o cursor está no meio dele', () => {
    expect(quebrarLinha('- PãoLeite', 5, 5).texto).toBe('- Pão\n- Leite')
  })

  it('Enter num item vazio encerra a lista', () => {
    const texto = '- [ ] Pão\n- [ ] '
    expect(quebrarLinha(texto, texto.length, texto.length)).toEqual({ texto: '- [ ] Pão\n', ini: 10, fim: 10 })
  })

  it('Enter num item vazio recuado sobe um nível', () => {
    const texto = '- Pão\n  - '
    expect(quebrarLinha(texto, texto.length, texto.length).texto).toBe('- Pão\n- ')
  })

  it('fora de lista, é um Enter comum', () => {
    expect(quebrarLinha('Texto', 5, 5)).toBeNull()
    expect(quebrarLinha('- Pão', 0, 0)).toBeNull()
  })
})

describe('checklist', () => {
  const lista = '# Loja\n- [ ] Pão\n- [x] Leite\n- [ ] Ovos\n- [x] Café\n\nObs\n- [x] Outra'

  it('marca e desmarca pelo índice da linha, sem mexer no resto', () => {
    expect(alternarTarefa('- [ ] Pão', 0)).toBe('- [x] Pão')
    expect(alternarTarefa('– [X] Pão', 0)).toBe('– [ ] Pão')
    expect(alternarTarefa('Texto', 0)).toBe('Texto')
  })

  it('conta o que foi feito', () => {
    expect(progressoDasTarefas(lista)).toEqual({ feitas: 3, total: 5 })
  })

  it('desmarca tudo', () => {
    expect(progressoDasTarefas(desmarcarTodas(lista))).toEqual({ feitas: 0, total: 5 })
  })

  it('leva os marcados para o fim de cada checklist, sem misturar checklists', () => {
    expect(marcadasParaOFim(lista)).toBe('# Loja\n- [ ] Pão\n- [ ] Ovos\n- [x] Leite\n- [x] Café\n\nObs\n- [x] Outra')
  })

  it('leva o item junto com os subitens dele', () => {
    const texto = '- [x] Presente\n  - [ ] embrulhar\n- [ ] Pão'
    expect(marcadasParaOFim(texto)).toBe('- [ ] Pão\n- [x] Presente\n  - [ ] embrulhar')
  })
})

describe('segmentosDaLinha', () => {
  it('separa negrito, itálico, riscado e código', () => {
    expect(segmentosDaLinha('a **b** _c_ ~~d~~ `e`')).toEqual([
      { tipo: 'texto', texto: 'a ' },
      { tipo: 'negrito', filhos: [{ tipo: 'texto', texto: 'b' }] },
      { tipo: 'texto', texto: ' ' },
      { tipo: 'italico', filhos: [{ tipo: 'texto', texto: 'c' }] },
      { tipo: 'texto', texto: ' ' },
      { tipo: 'riscado', filhos: [{ tipo: 'texto', texto: 'd' }] },
      { tipo: 'texto', texto: ' ' },
      { tipo: 'codigo', texto: 'e' },
    ])
  })

  it('aceita formatação dentro de formatação', () => {
    expect(segmentosDaLinha('**a _b_**')[0].filhos[1]).toEqual({ tipo: 'italico', filhos: [{ tipo: 'texto', texto: 'b' }] })
  })

  it('não trata nome_de_arquivo como itálico', () => {
    expect(segmentosDaLinha('nome_de_arquivo')).toEqual([{ tipo: 'texto', texto: 'nome_de_arquivo' }])
  })

  it('reconhece [[links]], links com texto e endereços soltos', () => {
    expect(segmentosDaLinha('ver [[Nota#Parte|o caso]]')[1]).toEqual({ tipo: 'link', alvo: 'Nota', texto: 'o caso' })
    expect(segmentosDaLinha('[site](https://a.com/x)')[0]).toEqual({ tipo: 'url', texto: 'site', url: 'https://a.com/x' })
    expect(segmentosDaLinha('em https://a.com/x.')[1]).toEqual({ tipo: 'url', texto: 'https://a.com/x', url: 'https://a.com/x' })
  })

  it('não transforma um "javascript:" em link', () => {
    expect(segmentosDaLinha('[x](javascript:alert(1))').every((p) => p.tipo === 'texto')).toBe(true)
  })
})

describe('texto sem formato', () => {
  it('tira a marcação para as prévias', () => {
    expect(linhaSemFormato('- [ ] **Pão** de [[Padaria|forma]]')).toBe('Pão de forma')
    expect(linhaSemFormato('---')).toBe('')
    expect(textoSemFormato('# Loja\n- Pão\n\n1. Leite')).toBe('Loja Pão Leite')
  })
})
