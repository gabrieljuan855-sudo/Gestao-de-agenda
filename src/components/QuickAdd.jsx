import { useEffect, useRef, useState } from 'react'
import { parseQuickAdd, decidirDestino } from '../lib/nlp.js'
import { toTimeInput, toDateInput } from '../lib/dates.js'
import { findDefaultCalendar } from '../lib/defaults.js'
import { PRIORITY_LABEL } from '../lib/priority.js'
import { construirRecorrencia, REPETICOES } from '../lib/recorrencia.js'

const REPETICAO_LABEL = Object.fromEntries(REPETICOES.map((r) => [r.id, r.label.toLowerCase()]))

// Capturar e organizar são dois gestos diferentes — mas quando o texto já diz
// sozinho o que ele é (hora certa = compromisso; prazo, prioridade,
// @contexto ou #projeto = próxima ação), pedir uma segunda decisão manual só
// deixa o app mais lento sem ganhar nada em troca. O Enter faz a coisa certa
// direto; o "Desfazer" que aparece depois é o preço de um parser que às
// vezes erra o palpite.
//
// Só o que sobra sem nenhum sinal claro — um pensamento cru — ainda vai para
// a Entrada, que é o único caso em que a triagem separada vale o tempo.
// `decidirDestino` (nlp.js) é quem decide isso, testado à parte.
function formatarDataBR(date) {
  return toDateInput(date).split('-').reverse().slice(0, 2).join('/')
}

function descreverDestino(destino, preview) {
  if (destino === 'evento') {
    const repeticao = preview.recorrencia ? `, ${REPETICAO_LABEL[preview.recorrencia]}` : ''
    return `Enter agenda: ${formatarDataBR(preview.start)} às ${toTimeInput(preview.start)}${repeticao}`
  }
  if (destino === 'tarefa') {
    const partes = []
    if (preview.due) partes.push(`prazo ${formatarDataBR(preview.due)}`)
    if (preview.priority) partes.push(`prioridade ${PRIORITY_LABEL[preview.priority]}`)
    if (preview.contexto) partes.push(`@${preview.contexto}`)
    if (preview.projeto) partes.push(`#${preview.projeto}`)
    return `Enter cria próxima ação${partes.length ? ' — ' + partes.join(', ') : ''}`
  }
  return null
}

const ROTULO_BOTAO = { evento: 'Agendar', tarefa: 'Criar tarefa', entrada: 'Capturar' }
const ROTULO_SALVANDO = { evento: 'Agendando...', tarefa: 'Criando...', entrada: 'Capturando...' }

export default function QuickAdd({
  calendars = [],
  proximasTasklistId,
  onCapture,
  onCreateEvent,
  onCreateTask,
  onDesfazerEvento,
  onDesfazerTarefa,
}) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [capturado, setCapturado] = useState(false)
  // O que fazer se o palpite estiver errado: guarda como desfazer o que acaba
  // de ser criado, e o texto original, para o caso de "isso não devia ter
  // pulado a Entrada".
  const [confirmacao, setConfirmacao] = useState(null)
  const [desfazendo, setDesfazendo] = useState(false)
  const inputRef = useRef(null)

  function handleChange(value) {
    setText(value)
    setError(null)
    setCapturado(false)
    setConfirmacao(null)
    setPreview(value.trim() ? parseQuickAdd(value) : null)
  }

  const destino = decidirDestino(preview)

  async function handleSubmit(e) {
    e.preventDefault()
    const limpo = text.trim()
    if (!limpo || saving) return
    setSaving(true)
    setError(null)
    setConfirmacao(null)
    try {
      if (destino === 'evento') {
        const calendario = findDefaultCalendar(calendars) || calendars[0]
        const calendarId = calendario?.id || 'primary'
        const recurrence = preview.recorrencia ? construirRecorrencia(preview.recorrencia, preview.start) : undefined
        const criado = await onCreateEvent({
          title: preview.title,
          start: preview.start,
          end: preview.end,
          calendarId,
          recurrence,
        })
        const repeticao = preview.recorrencia ? `, ${REPETICAO_LABEL[preview.recorrencia]}` : ''
        setConfirmacao({
          resumo: `✓ Compromisso "${preview.title}" em ${formatarDataBR(preview.start)} às ${toTimeInput(preview.start)}${repeticao}.`,
          desfazer: () => onDesfazerEvento({ id: criado.id, calendarId }),
          textoOriginal: limpo,
        })
      } else if (destino === 'tarefa') {
        const criada = await onCreateTask({
          title: preview.title,
          priority: preview.priority,
          due: preview.due,
          contexto: preview.contexto,
          projeto: preview.projeto,
          tasklistId: proximasTasklistId,
        })
        setConfirmacao({
          resumo: `✓ Próxima ação "${preview.title}"${preview.due ? `, prazo ${formatarDataBR(preview.due)}` : ''}.`,
          desfazer: () => onDesfazerTarefa({ id: criada.id, tasklistId: proximasTasklistId }),
          textoOriginal: limpo,
        })
      } else {
        await onCapture({ texto: limpo, due: null })
        setCapturado(true)
      }
      setText('')
      setPreview(null)
      // O campo continua aberto e com o cursor dentro: esvaziar a cabeça
      // costuma vir em rajada, uma coisa puxando a outra.
      inputRef.current?.focus()
    } catch (err) {
      setError(`Não deu certo: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function desfazer() {
    if (!confirmacao) return
    setDesfazendo(true)
    setError(null)
    try {
      await confirmacao.desfazer()
      setConfirmacao(null)
    } catch (err) {
      setError(`Não deu para desfazer: ${err.message}`)
    } finally {
      setDesfazendo(false)
    }
  }

  async function mandarParaEntrada() {
    if (!confirmacao) return
    setDesfazendo(true)
    setError(null)
    try {
      await confirmacao.desfazer()
      await onCapture({ texto: confirmacao.textoOriginal, due: null })
      setConfirmacao(null)
    } catch (err) {
      setError(`Não deu para mover para a Entrada: ${err.message}`)
    } finally {
      setDesfazendo(false)
    }
  }

  const dica = preview ? descreverDestino(destino, preview) : null

  return (
    <form onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        type="text"
        autoFocus
        placeholder="O que está na sua cabeça?"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        style={{ width: '100%' }}
      />

      {/* A dica só aparece quando o Enter vai fazer mais que capturar — é
          o aviso de que o texto vai pular a Entrada, para não surpreender. */}
      {dica && (
        <div className="muted" style={{ fontSize: 'var(--label-sm)', marginTop: 6 }}>
          {dica}
        </div>
      )}

      <button type="submit" className="primary" style={{ marginTop: 10 }} disabled={saving || !text.trim()}>
        {saving ? ROTULO_SALVANDO[destino] : ROTULO_BOTAO[destino]}
      </button>

      {capturado && !text && (
        <div className="muted" style={{ fontSize: 'var(--label-sm)', marginTop: 8 }}>
          ✓ Guardado na Entrada. Pode mandar a próxima.
        </div>
      )}

      {confirmacao && (
        <div className="quickadd-desvio">
          <span className="muted">{confirmacao.resumo}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={desfazer} disabled={desfazendo}>
              Desfazer
            </button>
            <button type="button" onClick={mandarParaEntrada} disabled={desfazendo}>
              Mandar p/ Entrada
            </button>
          </div>
        </div>
      )}

      {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
    </form>
  )
}
