import { useEffect, useRef, useState } from 'react'
import Banner from './Banner.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { ehDestrutiva, rotuloDaAcao } from '../lib/useAgent.js'
import { PRIORITY_LABEL } from '../lib/priority.js'

const STATUS_ICONE = {
  executando: '…',
  feito: '✓',
  erro: '!',
  orfa: '!',
}

// A linha do "o que eu vou fazer": o verbo, o alvo e os detalhes que mudam.
// Sem isso, aprovar seria assinar em branco.
function detalhesDaAcao(acao) {
  const partes = []
  if (acao.date) partes.push(acao.date.split('-').reverse().join('/'))
  if (acao.time) partes.push(acao.time)
  if (acao.durationMinutes) partes.push(`${acao.durationMinutes}min`)
  if (acao.priority) partes.push(PRIORITY_LABEL[acao.priority] || acao.priority)
  if (acao.presence) partes.push(acao.presence === 'vou' ? 'vou' : 'não vou')
  return partes.join(' · ')
}

function LinhaDeAcao({ acao, onApprove, onReject }) {
  const detalhes = detalhesDaAcao(acao)
  const parado = acao.status === 'idle'

  return (
    <li className={`agente-acao${ehDestrutiva(acao) ? ' danger' : ''} is-${acao.status}`}>
      <div className="agente-acao-texto">
        <div className="agente-acao-verbo">
          {STATUS_ICONE[acao.status] && (
            <span className="agente-acao-status" aria-hidden="true">{STATUS_ICONE[acao.status]}</span>
          )}
          {rotuloDaAcao(acao)}
        </div>
        <div className="agente-acao-alvo">{acao.resumo || acao.title}</div>
        {detalhes && <div className="agente-acao-detalhes">{detalhes}</div>}
        {acao.erro && <div className="form-error">{acao.erro}</div>}
      </div>
      {parado && (
        <div className="agente-acao-botoes">
          <button type="button" onClick={() => onReject(acao.id)}>Descartar</button>
          <button
            type="button"
            className={ehDestrutiva(acao) ? 'danger' : 'primary'}
            onClick={() => onApprove(acao.id)}
          >
            Aplicar
          </button>
        </div>
      )}
    </li>
  )
}

// O agente: conversa em várias rodadas e propõe ações sobre a agenda, as
// tarefas e (só lendo) as anotações. O estado mora em useAgent, chamado no
// App — o trilho desmonta este painel ao fechar, e a conversa precisa
// sobreviver a isso.
export default function AgentPanel({ agentState }) {
  const { messages, pending, thinking, error, dismissError, send, approve, approveAll, reject, clear } = agentState
  const [text, setText] = useState('')
  const [confirmandoTudo, setConfirmandoTudo] = useState(false)
  const fimRef = useRef(null)

  // A conversa cresce para baixo: sem isso, a resposta nova nasce fora da
  // área visível e parece que nada aconteceu.
  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, pending.length, thinking])

  function enviar() {
    const limpo = text.trim()
    if (!limpo || thinking) return
    send(limpo)
    setText('')
  }

  const pendentes = pending.filter((a) => a.status === 'idle')
  const temDestrutiva = pendentes.some(ehDestrutiva)

  function pedirTudo() {
    if (temDestrutiva) {
      setConfirmandoTudo(true)
      return
    }
    approveAll()
  }

  return (
    <div className="agente">
      {error && (
        <Banner tone="warning" actionLabel="✕" onAction={dismissError}>
          {error}
        </Banner>
      )}

      <div className="agente-conversa">
        {messages.length === 0 && !thinking && (
          <div className="muted" style={{ fontSize: 'var(--label-md)' }}>
            Peça o que quiser sobre a sua agenda: "o que tenho amanhã?", "remarca a reunião
            de terça para as 15h", "cria uma tarefa para ligar para a Ana". Eu mostro o que
            pretendo fazer antes de fazer.
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`agente-msg ${m.role === 'user' ? 'user' : 'ia'}`}>
            {m.text}
          </div>
        ))}

        {thinking && <div className="agente-msg ia muted">Pensando...</div>}

        {pending.length > 0 && (
          <>
            <ul className="agente-acoes">
              {pending.map((acao) => (
                <LinhaDeAcao key={acao.id} acao={acao} onApprove={approve} onReject={reject} />
              ))}
            </ul>
            {pendentes.length > 1 && (
              <div className="agente-acoes-rodape">
                <button type="button" className="primary" onClick={pedirTudo}>
                  Aplicar {pendentes.length} ações
                </button>
              </div>
            )}
          </>
        )}

        <div ref={fimRef} />
      </div>

      <form
        className="agente-entrada"
        onSubmit={(e) => {
          e.preventDefault()
          enviar()
        }}
      >
        <textarea
          rows={2}
          autoFocus
          placeholder="O que você quer fazer?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          // Enter envia, Shift+Enter quebra linha — o contrário do textarea
          // nativo, mas é o que se espera de um campo de conversa.
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              enviar()
            }
          }}
        />
        <div className="agente-entrada-botoes">
          {messages.length > 0 && (
            <button type="button" onClick={clear}>Limpar</button>
          )}
          <button type="submit" className="primary" disabled={thinking || !text.trim()}>
            Enviar
          </button>
        </div>
      </form>

      {confirmandoTudo && (
        <ConfirmDialog
          title="Aplicar todas as ações"
          message={`Entre elas há exclusão, que não dá para desfazer. Aplicar as ${pendentes.length} ações?`}
          confirmLabel="Aplicar tudo"
          danger
          onConfirm={() => {
            setConfirmandoTudo(false)
            approveAll()
          }}
          onCancel={() => setConfirmandoTudo(false)}
        />
      )}
    </div>
  )
}
