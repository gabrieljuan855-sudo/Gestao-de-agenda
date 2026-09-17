import { useEffect, useRef, useState } from 'react'
import { parseQuickAdd } from '../lib/nlp.js'
import { parseCommandWithAI } from '../lib/aiCommand.js'
import { searchEvents } from '../lib/googleApi.js'
import { semAcento } from '../lib/texto.js'
import { formatDuration, toTimeInput, fromInputs, toDateInput } from '../lib/dates.js'
import { isAllDay, eventStart, eventEnd } from '../lib/events.js'
import { PRIORITIES, DEFAULT_PRIORITY, priorityFromListTitle } from '../lib/priority.js'
import { findDefaultCalendar, findListForPriority } from '../lib/defaults.js'

const DURATION_OPTIONS = [20, 30, 45, 50, 60, 90, 120]

// Tempo de pausa na digitação antes de acionar a IA sozinha. Curto o
// suficiente para não parecer lento, longo o suficiente para não gastar uma
// chamada por letra digitada.
const AI_DEBOUNCE_MS = 900
const AI_MIN_LENGTH = 4

const ACTION_LABEL = {
  editar_evento: 'Mudar compromisso',
  excluir_evento: 'Excluir compromisso',
  editar_tarefa: 'Mudar tarefa',
  excluir_tarefa: 'Excluir tarefa',
  confirmar_presenca: 'Confirmar presença',
}

const PRESENCE_LABEL = { vou: 'vou', nao: 'não vou' }

// Converte o comando da IA (ação de criar) no mesmo formato que o parser
// local (parseQuickAdd) produz — o resto da tela não precisa saber se a
// prévia veio da leitura simples ou da IA.
function commandToPreview(cmd) {
  const base = {
    title: cmd.title || '',
    priority: cmd.priority,
    calendarId: cmd.calendarId || '',
    durationMinutes: cmd.durationMinutes || 60,
  }
  if (cmd.action === 'criar_evento' && cmd.date && cmd.time) {
    const start = fromInputs(cmd.date, cmd.time)
    return { ...base, type: 'event', start, end: new Date(start.getTime() + base.durationMinutes * 60000) }
  }
  return { ...base, type: 'task', due: cmd.date ? fromInputs(cmd.date) : null }
}

// Acha a tarefa (ainda não concluída) cujo título contém as palavras do que
// a IA leu no comando. Não é um match perfeito — por isso a tela sempre
// mostra qual tarefa achou antes de mexer nela, para a pessoa confirmar ou
// desistir se não for a certa.
function findTaskMatch(tasks, searchText) {
  const alvo = semAcento(searchText)
  if (!alvo) return null
  return tasks.find((t) => t.status !== 'completed' && semAcento(t.title).includes(alvo)) || null
}

// Monta o patch de updateEvent (lib/googleApi.js) a partir do comando: só
// mexe em data/hora quando a IA realmente leu uma mudança de data ou hora,
// mantendo a duração original do compromisso quando ela não foi dita.
function buildEventPatch(event, cmd) {
  const patch = {}
  if (cmd.title) patch.title = cmd.title
  if (cmd.date || cmd.time) {
    const allDay = isAllDay(event)
    const curStart = eventStart(event)
    const curEnd = eventEnd(event)
    const durationMinutes = cmd.durationMinutes || (curEnd - curStart) / 60000
    const dateStr = cmd.date || toDateInput(curStart)
    const start = allDay ? fromInputs(dateStr) : fromInputs(dateStr, cmd.time || toTimeInput(curStart))
    patch.start = start
    patch.end = new Date(start.getTime() + durationMinutes * 60000)
    patch.allDay = allDay
  }
  return patch
}

function buildTaskPatch(cmd) {
  return {
    title: cmd.title || undefined,
    due: cmd.date ? fromInputs(cmd.date) : undefined,
    priority: cmd.priority || undefined,
  }
}

export default function QuickAdd({
  calendars = [],
  taskLists = [],
  tasks = [],
  onCreateEvent,
  onCreateTask,
  onUpdateEvent,
  onDeleteEvent,
  onUpdateTask,
  onDeleteTask,
  onSetPresence,
  onDone,
}) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [calendarId, setCalendarId] = useState('')
  const [tasklistId, setTasklistId] = useState('')
  const [priority, setPriority] = useState(DEFAULT_PRIORITY)
  const [minutes, setMinutes] = useState(60)
  const [startTime, setStartTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [asking, setAsking] = useState(false)
  const [usedAI, setUsedAI] = useState(false)
  const [aiFailed, setAiFailed] = useState(false)
  // Comando não-criação (editar/excluir/confirmar presença): `command` é o
  // que a IA leu, `resolved` é o compromisso/tarefa de verdade que a busca
  // achou para aquele comando — nunca se executa nada sem os dois prontos e
  // sem a pessoa clicar em "Confirmar".
  const [command, setCommand] = useState(null)
  const [resolving, setResolving] = useState(false)
  const [resolved, setResolved] = useState(null)
  const [resolveError, setResolveError] = useState(null)
  const debounceRef = useRef(null)
  const abortRef = useRef(null)

  // As agendas chegam depois do primeiro render (vêm da API), por isso o padrão
  // é aplicado aqui e não no useState.
  useEffect(() => {
    if (calendarId) return
    // Se nenhuma agenda tem o nome esperado, vale a primeira: o seletor logo
    // abaixo mostra qual é. Deixar em branco travava o botão de salvar e não
    // dizia por quê — o compromisso simplesmente não tinha como ser criado.
    const preferred = findDefaultCalendar(calendars) || calendars[0]
    if (preferred) setCalendarId(preferred.id)
  }, [calendars, calendarId])

  // Prioridade e lista são a mesma coisa no Google Tasks do usuário: as listas
  // se chamam "Prioridade Máxima", "Prioridade Média"... Então escolher uma
  // move a outra junto, em vez de pedir a mesma informação duas vezes.
  useEffect(() => {
    const list = findListForPriority(taskLists, priority)
    if (list) {
      setTasklistId(list.id)
      return
    }
    // Sem lista com o nome dessa prioridade (listas com nome próprio, ou uma
    // prioridade que não tem lista): mantém a que já estava escolhida, ou cai
    // na primeira. O que não pode é ficar vazio — era isso que travava o
    // botão "Criar tarefa" sem nenhuma explicação na tela.
    setTasklistId((current) =>
      current && taskLists.some((l) => l.id === current) ? current : taskLists[0]?.id || ''
    )
  }, [taskLists, priority])

  function applyPreview(parsed) {
    setPreview(parsed)
    if (parsed?.type === 'event') {
      setMinutes(parsed.durationMinutes || 60)
      setStartTime(toTimeInput(parsed.start))
    }
    if (parsed?.calendarId) setCalendarId(parsed.calendarId)
    // O texto só muda a prioridade quando diz algo ("urgente", "prazo"); do
    // contrário o que estiver selecionado continua valendo.
    if (parsed?.priority) setPriority(parsed.priority)
  }

  // Depois que a IA lê um comando de editar/excluir/confirmar presença, ainda
  // falta achar QUAL compromisso ou tarefa de verdade é esse — a IA só leu o
  // texto, não tem acesso à agenda inteira. A busca roda sobre o que já está
  // carregado (tarefas) ou sobre o cache amplo de compromissos (googleApi.js).
  async function resolveTarget(cmd, signal) {
    setResolving(true)
    setResolveError(null)
    setResolved(null)
    try {
      if (cmd.action === 'editar_tarefa' || cmd.action === 'excluir_tarefa') {
        const match = findTaskMatch(tasks, cmd.searchText)
        if (signal.aborted) return
        if (!match) {
          setResolveError('Não encontrei nenhuma tarefa parecida com essa.')
          return
        }
        setResolved({ kind: 'task', item: match })
      } else {
        const found = await searchEvents(cmd.searchText)
        if (signal.aborted) return
        if (!found.length) {
          setResolveError('Não encontrei nenhum compromisso parecido com esse.')
          return
        }
        setResolved({ kind: 'event', item: found[0] })
      }
    } catch (err) {
      if (signal.aborted) return
      setResolveError(`Não deu para procurar: ${err.message}`)
    } finally {
      if (!signal.aborted) setResolving(false)
    }
  }

  // A IA roda sozinha depois de uma pausa na digitação, sem exigir clique: o
  // parser local já preenche a prévia de criação na hora, e a IA a substitui
  // assim que fica pronta — inclusive trocando para uma ação bem diferente
  // (editar, excluir, confirmar presença) quando é disso que o texto trata.
  async function askAI(value) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setAsking(true)
    setAiFailed(false)
    try {
      const cmd = await parseCommandWithAI(value, calendars, { signal: controller.signal })
      if (controller.signal.aborted) return
      setUsedAI(true)
      if (cmd.action === 'criar_evento' || cmd.action === 'criar_tarefa') {
        setCommand(null)
        applyPreview(commandToPreview(cmd))
      } else {
        setCommand(cmd)
        if (cmd.action !== 'desconhecido') await resolveTarget(cmd, controller.signal)
      }
    } catch (err) {
      if (err.name === 'AbortError') return
      // A prévia local já está na tela — a IA é um reforço, não o único
      // caminho. Sem isso, um Worker fora do ar travaria a digitação toda.
      setAiFailed(true)
    } finally {
      if (!controller.signal.aborted) setAsking(false)
    }
  }

  function handleChange(value) {
    setText(value)
    setError(null)
    setUsedAI(false)
    setAiFailed(false)
    setCommand(null)
    setResolved(null)
    setResolveError(null)
    // Palpite instantâneo de criação, enquanto a IA não respondeu — ela pode
    // substituir por uma ação totalmente diferente assim que chegar.
    applyPreview(value.trim() ? parseQuickAdd(value) : null)

    clearTimeout(debounceRef.current)
    abortRef.current?.abort()
    setAsking(false)

    if (value.trim().length >= AI_MIN_LENGTH) {
      debounceRef.current = setTimeout(() => askAI(value), AI_DEBOUNCE_MS)
    }
  }

  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current)
      abortRef.current?.abort()
    }
  }, [])

  function handleListChange(id) {
    setTasklistId(id)
    const list = taskLists.find((l) => l.id === id)
    const fromList = list && priorityFromListTitle(list.title)
    if (fromList) setPriority(fromList)
  }

  // Um comando não-criação some da tela de "prévia de criação" assim que a
  // IA responde — as duas telas nunca aparecem juntas.
  const showCreatePreview = !command && preview
  const isEvent = preview?.type === 'event'
  const needsCalendar = isEvent && calendars.length > 0 && !calendarId
  const needsList = !isEvent && taskLists.length > 0 && !tasklistId

  // Quando toda lista do usuário já é "Prioridade Alta/Média/Baixa", o
  // seletor de lista só repetiria os botões de prioridade logo acima. Só faz
  // sentido mostrá-lo separado quando existe alguma lista de nome próprio.
  const temListaFora = taskLists.some((list) => !priorityFromListTitle(list.title))

  function resetDefaults() {
    setText('')
    setPreview(null)
    setPriority(DEFAULT_PRIORITY)
    setUsedAI(false)
    setAiFailed(false)
    setAsking(false)
    setCommand(null)
    setResolved(null)
    setResolveError(null)
    clearTimeout(debounceRef.current)
    abortRef.current?.abort()
    const preferred = findDefaultCalendar(calendars)
    setCalendarId(preferred ? preferred.id : '')
  }

  async function handleConfirm() {
    setSaving(true)
    setError(null)
    try {
      if (command && resolved) {
        const { item } = resolved
        if (command.action === 'excluir_evento') await onDeleteEvent(item)
        else if (command.action === 'editar_evento') await onUpdateEvent(item, buildEventPatch(item, command))
        else if (command.action === 'confirmar_presenca') await onSetPresence(item, command.presence)
        else if (command.action === 'excluir_tarefa') await onDeleteTask(item)
        else if (command.action === 'editar_tarefa') await onUpdateTask(item, buildTaskPatch(command))
        else return
      } else if (preview) {
        if (isEvent) {
          const start = fromInputs(toDateInput(preview.start), startTime)
          const end = new Date(start.getTime() + minutes * 60000)
          await onCreateEvent({ ...preview, start, end, calendarId })
        } else {
          await onCreateTask({ ...preview, priority, tasklistId })
        }
      } else {
        return
      }
      resetDefaults()
      onDone && onDone()
    } catch (err) {
      setError(`Não deu para salvar: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const commandActionable = command && command.action !== 'desconhecido'
  const eventLabel = (event) => {
    const start = eventStart(event)
    return `${event.summary || '(sem título)'} — ${start.toLocaleDateString('pt-BR')} ${isAllDay(event) ? '' : toTimeInput(start)}`.trim()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleConfirm()
      }}
    >
      {/* O painel só abre no clique, então o campo já chega com o cursor
          dentro: abrir e ter que clicar de novo era um toque a mais em toda
          tarefa criada. Além de criar, dá para pedir para mudar, excluir ou
          confirmar presença num compromisso ou tarefa que já existe. */}
      <input
        type="text"
        autoFocus
        placeholder="Ex: desmarcar a reunião de terça, ou reunião de equipe terça 13h15"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        style={{ width: '100%' }}
      />

      {/* Comando de editar/excluir/confirmar presença: aparece assim que a IA
          responde, no lugar da prévia de criação. */}
      {command && (
        <div style={{ marginTop: 10, fontSize: 'var(--body-sm)' }}>
          {!commandActionable ? (
            <div className="muted">
              {command.summary || 'Não entendi esse comando — tenta descrever de outro jeito?'}
            </div>
          ) : resolving ? (
            <div className="muted">Procurando...</div>
          ) : resolveError ? (
            <div className="form-error">{resolveError}</div>
          ) : resolved ? (
            <>
              <div className="muted" style={{ marginBottom: 6 }}>{ACTION_LABEL[command.action]}</div>
              <div style={{ marginBottom: 6 }}>
                <strong>{resolved.kind === 'event' ? eventLabel(resolved.item) : resolved.item.title}</strong>
              </div>
              {command.action === 'confirmar_presenca' && (
                <div className="muted" style={{ marginBottom: 6 }}>
                  Marcar presença como: <strong>{PRESENCE_LABEL[command.presence] || command.presence}</strong>
                </div>
              )}
              {command.action === 'editar_evento' || command.action === 'editar_tarefa' ? (
                <div className="muted" style={{ marginBottom: 6 }}>{command.summary}</div>
              ) : null}
              {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
              <button
                type="submit"
                className={command.action.startsWith('excluir_') ? 'danger' : 'primary'}
                style={{ marginTop: 4 }}
                disabled={saving}
              >
                {saving ? 'Executando...' : 'Confirmar'}
              </button>
            </>
          ) : null}
        </div>
      )}

      {showCreatePreview && (
        <div style={{ marginTop: 10, fontSize: 'var(--body-sm)' }}>
          <div className="muted" style={{ marginBottom: 6 }}>
            {asking
              ? 'Revisando com a IA...'
              : usedAI
                ? 'A IA entendeu assim:'
                : aiFailed
                  ? 'IA indisponível agora — ficou na leitura simples:'
                  : 'Entendi assim:'}
          </div>

          <div style={{ marginBottom: 10 }}>
            <strong>{preview.title}</strong>
          </div>

          <div className="quickadd-fields">
            {isEvent ? (
              <>
                <label className="field">
                  <span>Dia</span>
                  <input
                    type="date"
                    value={toDateInput(preview.start)}
                    onChange={(e) =>
                      setPreview({ ...preview, start: fromInputs(e.target.value, startTime) })
                    }
                  />
                </label>
                <label className="field">
                  <span>Início</span>
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </label>
                <label className="field">
                  <span>Duração</span>
                  <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                    {[...new Set([...DURATION_OPTIONS, minutes])]
                      .sort((a, b) => a - b)
                      .map((m) => (
                        <option key={m} value={m}>{formatDuration(m)}</option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span>Agenda</span>
                  <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
                    <option value="">Escolha a agenda...</option>
                    {calendars.map((cal) => (
                      <option key={cal.id} value={cal.id}>{cal.summaryOverride || cal.summary}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                {preview.due && (
                  <label className="field">
                    <span>Prazo</span>
                    <input
                      type="date"
                      value={toDateInput(preview.due)}
                      onChange={(e) => setPreview({ ...preview, due: fromInputs(e.target.value) })}
                    />
                  </label>
                )}
                <div className="field">
                  <span>Prioridade</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {PRIORITIES.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPriority(p.id)}
                        className={`pill ${p.id}`}
                        style={{
                          border: priority === p.id ? '2px solid var(--text-primary)' : '1px solid transparent',
                          cursor: 'pointer',
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                {temListaFora && (
                  <label className="field">
                    <span>Lista</span>
                    <select value={tasklistId} onChange={(e) => handleListChange(e.target.value)}>
                      <option value="">Escolha a lista...</option>
                      {taskLists.map((list) => (
                        <option key={list.id} value={list.id}>{list.title}</option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </div>

          {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}

          <button
            type="submit"
            className="primary"
            style={{ marginTop: 10 }}
            disabled={saving || needsCalendar || needsList}
          >
            {saving ? 'Salvando...' : isEvent ? 'Criar compromisso' : 'Criar tarefa'}
          </button>
        </div>
      )}
    </form>
  )
}
