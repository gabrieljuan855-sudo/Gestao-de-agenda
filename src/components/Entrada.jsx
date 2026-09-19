import { useEffect, useState } from 'react'
import { toDateInput, fromInputs } from '../lib/dates.js'
import { esclarecerItem } from '../lib/aiEsclarecer.js'
import { IA_DESLIGADA } from '../lib/aiCooldown.js'

// O passo que faltava entre capturar e fazer.
//
// Capturar é jogar o pensamento num lugar confiável sem pensar. Isso deixa a
// Entrada cheia de coisa crua — "escola joão vaga ligar" — que não é tarefa
// nem compromisso ainda, é só um lembrete de que existe um assunto. Decidir o
// que aquilo é dá trabalho de cabeça, e é justamente por isso que precisa ser
// um momento separado: em lote, um item por vez, com as opções na tela em vez
// de na memória.
//
// A pergunta que organiza a tela é sempre a mesma: **qual é a próxima ação
// física?** Não "o que é isso", mas "o que eu faço a seguir por causa disso".
export default function Entrada({
  itens = [],
  contextos = [],
  projetos = [],
  onProximaAcao,
  onAguardando,
  onAgendar,
  onAlgumDia,
  onReferencia,
  onConcluir,
  onExcluir,
}) {
  const [indice, setIndice] = useState(0)
  const [titulo, setTitulo] = useState('')
  const [contexto, setContexto] = useState('')
  const [novoContexto, setNovoContexto] = useState('')
  const [projeto, setProjeto] = useState('')
  const [duracao, setDuracao] = useState('')
  const [quem, setQuem] = useState('')
  const [data, setData] = useState('')
  const [hora, setHora] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState(null)
  const [esclarecendo, setEsclarecendo] = useState(false)
  const [sugestao, setSugestao] = useState(null)

  const item = itens[Math.min(indice, Math.max(itens.length - 1, 0))] || null

  // Trocar de item zera tudo: os campos do anterior não podem vazar para o
  // seguinte (um "quem" esquecido criaria uma espera de outra pessoa).
  useEffect(() => {
    setTitulo(item?.title || '')
    setContexto('')
    setNovoContexto('')
    setProjeto('')
    setDuracao('')
    setQuem('')
    setData(item?.due ? toDateInput(new Date(item.due)) : '')
    setHora('')
    setErro(null)
    setSugestao(null)
  }, [item?.id])

  if (!item) {
    return (
      <div>
        <h3 className="t-title" style={{ marginTop: 0 }}>Entrada</h3>
        <p className="muted" style={{ fontSize: 'var(--body-sm)' }}>
          Vazia. Tudo que você anotou já virou alguma coisa.
        </p>
      </div>
    )
  }

  const contextoFinal = (novoContexto.trim() || contexto).trim()

  async function executar(acao) {
    if (salvando) return
    setSalvando(true)
    setErro(null)
    try {
      await acao()
      // O item sai da lista sozinho na próxima carga; o índice fica onde está
      // para o seguinte assumir o lugar.
      setSugestao(null)
    } catch (err) {
      setErro(`Não deu certo: ${err.message}`)
    } finally {
      setSalvando(false)
    }
  }

  async function pedirAjuda() {
    setEsclarecendo(true)
    setErro(null)
    try {
      const proposta = await esclarecerItem(item.title || '', contextos)
      setSugestao(proposta)
      // A proposta preenche os campos, não decide nada: quem aperta o botão
      // continua sendo a pessoa.
      if (proposta.titulo) setTitulo(proposta.titulo)
      if (proposta.contexto) setContexto(proposta.contexto)
      if (proposta.quem) setQuem(proposta.quem)
      if (proposta.date) setData(proposta.date)
      if (proposta.time) setHora(proposta.time)
    } catch (err) {
      setErro(
        err.transiente
          ? 'A IA está sobrecarregada ou sem cota por agora — dá para decidir na mão normalmente.'
          : `Não deu para pedir ajuda da IA (${err.message}).`
      )
    } finally {
      setEsclarecendo(false)
    }
  }

  const tituloLimpo = titulo.trim()
  const podeArquivar = Boolean(tituloLimpo) && !salvando

  return (
    <div>
      <div className="entrada-topo">
        <h3 className="t-title" style={{ margin: 0 }}>Entrada</h3>
        <span className="muted" style={{ fontSize: 'var(--label-sm)' }}>
          {itens.length === 1 ? '1 item' : `${itens.length} itens`}
        </span>
      </div>

      <label className="field">
        <span>O que é isso, em uma frase?</span>
        <textarea rows={2} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
      </label>

      {sugestao && (
        <div className="muted" style={{ fontSize: 'var(--label-sm)', marginBottom: 8 }}>
          A IA achou que isto é {ROTULO_TIPO[sugestao.tipo] || 'algo a decidir'}. Confira antes de arquivar.
        </div>
      )}

      {!IA_DESLIGADA && (
        <button type="button" onClick={pedirAjuda} disabled={esclarecendo || salvando} style={{ marginBottom: 12 }}>
          {esclarecendo ? 'Pensando...' : '✨ Não sei o que fazer com isso'}
        </button>
      )}

      {/* A regra dos dois minutos vem antes de qualquer arquivamento: se dá
          para resolver agora, organizar aquilo custa mais caro que fazer. */}
      <div className="entrada-dois-minutos">
        <span>Dá para resolver em 2 minutos?</span>
        <button type="button" onClick={() => executar(() => onConcluir(item))} disabled={salvando}>
          Já fiz
        </button>
      </div>

      <div className="entrada-secao">Se não, isto vira:</div>

      <div className="entrada-bloco">
        <div className="entrada-bloco-titulo">Próxima ação — eu que faço</div>
        <div className="entrada-contextos">
          {contextos.map((c) => (
            <button
              key={c}
              type="button"
              className={`pill-filtro${contexto === c && !novoContexto.trim() ? ' is-escolhido' : ''}`}
              onClick={() => {
                setContexto(contexto === c ? '' : c)
                setNovoContexto('')
              }}
            >
              @{c}
            </button>
          ))}
          <input
            type="text"
            placeholder="novo contexto"
            value={novoContexto}
            onChange={(e) => setNovoContexto(e.target.value)}
            className="entrada-contexto-novo"
          />
        </div>
        {/* Um projeto é só a mesma etiqueta repetida em mais de uma tarefa —
            texto livre, não um cadastro à parte. Datalist sugere os que já
            existem sem impedir criar um novo digitando. */}
        <input
          type="text"
          placeholder="parte de um projeto? (opcional)"
          value={projeto}
          onChange={(e) => setProjeto(e.target.value)}
          list="entrada-projetos"
          style={{ width: '100%', marginBottom: 8 }}
        />
        <datalist id="entrada-projetos">
          {projetos.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        {/* Opcional, e só para quem quer: sem estimativa a tarefa continua
            aparecendo na tela Agora, só não entra no filtro por tempo livre. */}
        <input
          type="number"
          min="1"
          placeholder="quanto tempo leva? em minutos (opcional)"
          value={duracao}
          onChange={(e) => setDuracao(e.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        />
        <button
          type="button"
          className="primary"
          disabled={!podeArquivar}
          onClick={() =>
            executar(() =>
              onProximaAcao(item, {
                titulo: tituloLimpo,
                contexto: contextoFinal || null,
                projeto: projeto.trim() || null,
                duracao: duracao ? Number(duracao) : null,
              })
            )
          }
        >
          É a próxima ação
        </button>
      </div>

      <div className="entrada-bloco">
        <div className="entrada-bloco-titulo">Aguardando — outra pessoa é que faz</div>
        <input
          type="text"
          placeholder="Esperando quem?"
          value={quem}
          onChange={(e) => setQuem(e.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        />
        <button
          type="button"
          disabled={!podeArquivar || !quem.trim()}
          onClick={() => executar(() => onAguardando(item, { titulo: tituloLimpo, quem: quem.trim() }))}
        >
          Estou esperando
        </button>
      </div>

      <div className="entrada-bloco">
        <div className="entrada-bloco-titulo">Agendar — tem hora marcada</div>
        <div className="field-row">
          <label className="field">
            <span>Dia</span>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
          <label className="field">
            <span>Hora</span>
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </label>
        </div>
        <button
          type="button"
          disabled={!podeArquivar || !data || !hora}
          style={{ marginTop: 8 }}
          onClick={() =>
            executar(() => onAgendar(item, { titulo: tituloLimpo, start: fromInputs(data, hora) }))
          }
        >
          Pôr na agenda
        </button>
      </div>

      <div className="entrada-outros">
        <button
          type="button"
          disabled={!podeArquivar}
          onClick={() => executar(() => onAlgumDia(item, { titulo: tituloLimpo }))}
        >
          Algum dia
        </button>
        <button
          type="button"
          disabled={!podeArquivar}
          onClick={() => executar(() => onReferencia(item, { titulo: tituloLimpo }))}
        >
          É só referência
        </button>
        <button type="button" className="danger" disabled={salvando} onClick={() => executar(() => onExcluir(item))}>
          Lixo
        </button>
        <button
          type="button"
          disabled={salvando || itens.length < 2}
          onClick={() => setIndice((i) => (i + 1) % itens.length)}
        >
          Depois
        </button>
      </div>

      {erro && <div className="form-error" style={{ marginTop: 10 }}>{erro}</div>}
    </div>
  )
}

const ROTULO_TIPO = {
  acao: 'uma próxima ação sua',
  aguardando: 'uma espera por outra pessoa',
  agendar: 'algo com hora marcada',
  algum_dia: 'algo para algum dia',
  referencia: 'só referência',
}
