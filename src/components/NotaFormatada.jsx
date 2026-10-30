import { useState } from 'react'
import { linhasDoTexto, segmentosDaLinha } from '../lib/notasFormatacao.js'

// A anotação formatada, para ler: títulos, listas, a checklist com o círculo
// que se toca para marcar, como no Notas do iPhone. Tocar no texto abre a
// edição naquela linha (onEditar recebe a posição no texto cru). Fora de
// edição, a marcação ("- [ ]", "**") não aparece — é ela que deixava a nota
// com cara de código.

function Segmentos({ partes, resolverLink, onAbrirLink, onCriarLink }) {
  return partes.map((p, i) => {
    switch (p.tipo) {
      case 'negrito':
        return <strong key={i}><Segmentos partes={p.filhos} {...{ resolverLink, onAbrirLink, onCriarLink }} /></strong>
      case 'italico':
        return <em key={i}><Segmentos partes={p.filhos} {...{ resolverLink, onAbrirLink, onCriarLink }} /></em>
      case 'riscado':
        return <s key={i}><Segmentos partes={p.filhos} {...{ resolverLink, onAbrirLink, onCriarLink }} /></s>
      case 'codigo':
        return <code key={i} className="nf-codigo">{p.texto}</code>
      case 'url':
        return (
          <a key={i} href={p.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            {p.texto}
          </a>
        )
      case 'link': {
        const nota = resolverLink?.(p.alvo)
        if (!onAbrirLink) return <span key={i} className="nf-link">{p.texto}</span>
        return (
          <button
            key={i}
            type="button"
            className={`nf-link${nota ? '' : ' is-nova'}`}
            title={nota ? undefined : 'Esta nota ainda não existe — tocar cria'}
            onClick={(e) => {
              e.stopPropagation()
              if (nota) onAbrirLink(nota.id)
              else onCriarLink(p.alvo)
            }}
          >
            {p.texto}
          </button>
        )
      }
      default:
        return p.texto
    }
  })
}

function Circulo({ marcado }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      {marcado ? (
        <>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <polyline points="7.5 12.5 10.5 15.5 16.5 9" fill="none" stroke="var(--on-primary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      )}
    </svg>
  )
}

export function CorpoFormatado({ texto, onEditar, onAlternarTarefa, resolverLink, onAbrirLink, onCriarLink, placeholder }) {
  const linhas = linhasDoTexto(texto)
  const interativo = Boolean(onEditar)
  const links = { resolverLink, onAbrirLink, onCriarLink }

  // Selecionar um trecho para copiar não é pedir para editar.
  function editarEm(posicao) {
    if (!interativo) return
    if (window.getSelection?.().toString()) return
    onEditar(posicao)
  }

  // Numeração contada pela tela, a partir do primeiro número da lista:
  // "1. 1. 1." escrito à mão (comum em texto colado) aparece como 1, 2, 3 —
  // o mesmo que o Markdown faz.
  const contagem = []

  const vazia = !texto.trim()
  return (
    <div
      className={`nf-corpo${interativo ? ' is-interativo' : ''}`}
      onClick={interativo ? () => editarEm(texto.length) : undefined}
      onKeyDown={interativo ? (e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onEditar(texto.length)
        }
      } : undefined}
      tabIndex={interativo ? 0 : undefined}
      role={interativo ? 'group' : undefined}
      aria-label={interativo ? 'Texto da anotação — tocar para editar' : undefined}
    >
      {vazia && interativo && <p className="nf-placeholder">{placeholder}</p>}
      {!vazia && linhas.map((l) => {
        if (l.tipo !== 'numerada') contagem.length = Math.min(contagem.length, l.tipo === 'vazia' ? contagem.length : l.nivel)
        const recuo = l.nivel ? { paddingLeft: `${l.nivel * 24}px` } : undefined
        const aoTocar = (e) => {
          e.stopPropagation()
          editarEm(l.ate)
        }
        const conteudo = <Segmentos partes={segmentosDaLinha(l.conteudo)} {...links} />

        switch (l.tipo) {
          case 'vazia':
            return <div key={l.indice} className="nf-vazia" onClick={aoTocar} />
          case 'divisor':
            return <hr key={l.indice} className="nf-divisor" onClick={aoTocar} />
          case 'titulo':
            return <h2 key={l.indice} className="nf-titulo" onClick={aoTocar}>{conteudo}</h2>
          case 'subtitulo':
            return <h3 key={l.indice} className="nf-subtitulo" onClick={aoTocar}>{conteudo}</h3>
          case 'cabecalho':
            return <h4 key={l.indice} className="nf-cabecalho" onClick={aoTocar}>{conteudo}</h4>
          case 'citacao':
            return <blockquote key={l.indice} className="nf-citacao" onClick={aoTocar}>{conteudo}</blockquote>
          case 'tarefa':
            return (
              <div key={l.indice} className={`nf-item nf-tarefa${l.marcado ? ' is-feita' : ''}`} style={recuo} onClick={aoTocar}>
                {onAlternarTarefa ? (
                  <button
                    type="button"
                    className="nf-circulo"
                    role="checkbox"
                    aria-checked={l.marcado}
                    aria-label={l.marcado ? 'Desmarcar' : 'Marcar como feito'}
                    onClick={(e) => {
                      e.stopPropagation()
                      onAlternarTarefa(l.indice)
                    }}
                  >
                    <Circulo marcado={l.marcado} />
                  </button>
                ) : (
                  <span className="nf-circulo"><Circulo marcado={l.marcado} /></span>
                )}
                <span className="nf-item-texto">{conteudo}</span>
              </div>
            )
          case 'marcador':
            return (
              <div key={l.indice} className="nf-item" style={recuo} onClick={aoTocar}>
                <span className="nf-marca" aria-hidden="true">{l.nivel % 2 ? '◦' : '•'}</span>
                <span className="nf-item-texto">{conteudo}</span>
              </div>
            )
          case 'numerada': {
            contagem.length = l.nivel + 1
            contagem[l.nivel] = contagem[l.nivel] ? contagem[l.nivel] + 1 : l.numero
            return (
              <div key={l.indice} className="nf-item" style={recuo} onClick={aoTocar}>
                <span className="nf-marca nf-numero" aria-hidden="true">{contagem[l.nivel]}.</span>
                <span className="nf-item-texto">{conteudo}</span>
              </div>
            )
          }
          default:
            return <p key={l.indice} className="nf-paragrafo" style={recuo} onClick={aoTocar}>{conteudo}</p>
        }
      })}
    </div>
  )
}

// ---- barra de ferramentas da edição ----

const Icone = ({ children }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

const ESTILOS_DE_TEXTO = [
  ['titulo', 'Título', 'nf-op-titulo'],
  ['subtitulo', 'Subtítulo', 'nf-op-subtitulo'],
  ['cabecalho', 'Cabeçalho', 'nf-op-cabecalho'],
  ['texto', 'Corpo', ''],
]

const MARCAS = [
  ['**', 'Negrito', <strong key="b">N</strong>],
  ['_', 'Itálico', <em key="i" style={{ fontFamily: 'var(--font-heading)' }}>I</em>],
  ['~~', 'Riscado', <s key="s">S</s>],
  ['`', 'Código', <span key="c" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--body-sm)' }}>{'</>'}</span>],
]

// Como o "Aa" e a checklist em cima do teclado do Notas: os estilos de linha
// e de texto à mão, sem decorar marcação. Os botões não podem tirar o foco do
// texto (onMouseDown/onPointerDown), senão o teclado fecha a cada toque e a
// seleção se perde antes de o estilo ser aplicado.
export function BarraDeFormatacao({ estiloAtual, topo, onEstilo, onMarca, onRecuo, onLink, onDivisor, onOk }) {
  const [estilosAbertos, setEstilosAbertos] = useState(false)
  const manterFoco = (e) => e.preventDefault()
  const botao = (rotulo, onClick, filhos, { ativo, classe = '' } = {}) => (
    <button
      key={rotulo}
      type="button"
      className={`nf-ferramenta ${classe}${ativo ? ' is-ativa' : ''}`}
      onMouseDown={manterFoco}
      onPointerDown={manterFoco}
      onClick={onClick}
      aria-label={rotulo}
      title={rotulo}
      aria-pressed={ativo === undefined ? undefined : ativo}
    >
      {filhos}
    </button>
  )

  return (
    <div className="nf-barra" style={{ top: topo }} role="toolbar" aria-label="Formatação">
      {estilosAbertos && (
        <div className="nf-barra-linha nf-barra-estilos">
          {ESTILOS_DE_TEXTO.map(([estilo, rotulo, classe]) =>
            botao(rotulo, () => onEstilo(estilo === 'texto' ? 'corpo' : estilo), <span className={classe}>{rotulo}</span>, {
              ativo: estiloAtual === estilo || (estilo === 'texto' && estiloAtual === 'vazia'),
              classe: 'nf-ferramenta--texto',
            })
          )}
          <span className="nf-separador" />
          {MARCAS.map(([marca, rotulo, filho]) => botao(rotulo, () => onMarca(marca), filho))}
          <span className="nf-separador" />
          {botao('Citação', () => onEstilo('citacao'), (
            <Icone><path d="M7 7h4v4c0 3-1.5 5-4 6" /><path d="M14 7h4v4c0 3-1.5 5-4 6" /></Icone>
          ), { ativo: estiloAtual === 'citacao' })}
          {botao('Linha divisória', onDivisor, <Icone><line x1="4" y1="12" x2="20" y2="12" /></Icone>)}
        </div>
      )}
      <div className="nf-barra-linha">
        {botao('Estilos de texto', () => setEstilosAbertos((v) => !v), <span className="nf-aa">Aa</span>, { ativo: estilosAbertos })}
        {botao('Checklist', () => onEstilo('tarefa'), (
          <Icone>
            <circle cx="6" cy="7" r="2.5" />
            <polyline points="4.8 16.8 5.9 17.9 8 15.5" />
            <circle cx="6" cy="17" r="2.5" />
            <line x1="12" y1="7" x2="20" y2="7" />
            <line x1="12" y1="17" x2="20" y2="17" />
          </Icone>
        ), { ativo: estiloAtual === 'tarefa' })}
        {botao('Lista com marcadores', () => onEstilo('marcador'), (
          <Icone>
            <circle cx="5" cy="7" r="1" fill="currentColor" />
            <circle cx="5" cy="12" r="1" fill="currentColor" />
            <circle cx="5" cy="17" r="1" fill="currentColor" />
            <line x1="9.5" y1="7" x2="20" y2="7" />
            <line x1="9.5" y1="12" x2="20" y2="12" />
            <line x1="9.5" y1="17" x2="20" y2="17" />
          </Icone>
        ), { ativo: estiloAtual === 'marcador' })}
        {botao('Lista numerada', () => onEstilo('numerada'), (
          <Icone>
            <path d="M4 5.5l1.5-1v5" strokeWidth="1.5" />
            <path d="M3.8 14.2c.3-.7 2.6-.9 2.4.6-.2 1-2.4 2.2-2.4 3.2h2.6" strokeWidth="1.5" />
            <line x1="10" y1="7" x2="20" y2="7" />
            <line x1="10" y1="16" x2="20" y2="16" />
          </Icone>
        ), { ativo: estiloAtual === 'numerada' })}
        {botao('Diminuir recuo', () => onRecuo(-1), (
          <Icone><line x1="11" y1="6" x2="20" y2="6" /><line x1="11" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /><polyline points="7 4 4 6.5 7 9" /></Icone>
        ))}
        {botao('Aumentar recuo', () => onRecuo(1), (
          <Icone><line x1="11" y1="6" x2="20" y2="6" /><line x1="11" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /><polyline points="4 4 7 6.5 4 9" /></Icone>
        ))}
        {botao('Ligar a outra anotação', onLink, <span className="nf-colchetes">[[ ]]</span>)}
        <span style={{ flex: 1 }} />
        <button type="button" className="nf-ok" onMouseDown={manterFoco} onPointerDown={manterFoco} onClick={onOk}>
          OK
        </button>
      </div>
    </div>
  )
}

// Quanto da checklist já foi feito, com as duas arrumações do Notas: desmarcar
// tudo (a lista de compras que volta toda semana) e levar os marcados para o
// fim (o que falta fica junto, em cima).
export function ResumoDaChecklist({ feitas, total, onDesmarcar, onMarcadasParaOFim }) {
  if (!total) return null
  return (
    <div className="nf-resumo">
      <span className="nf-progresso" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={feitas} aria-label="Itens feitos">
        <span style={{ width: `${(feitas / total) * 100}%` }} />
      </span>
      <span className="nf-resumo-texto">{feitas} de {total}</span>
      <span style={{ flex: 1 }} />
      {feitas > 0 && feitas < total && (
        <button type="button" className="nf-acao" onClick={onMarcadasParaOFim} title="Levar os itens marcados para o fim da lista">Feitos no fim</button>
      )}
      {feitas > 0 && (
        <button type="button" className="nf-acao" onClick={onDesmarcar} title="Desmarcar todos os itens">Desmarcar</button>
      )}
    </div>
  )
}
