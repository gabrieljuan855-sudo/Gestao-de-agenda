import { useEffect, useRef, useState } from 'react'
import { parseQuickAdd } from '../lib/nlp.js'
import { parseWithAI } from '../lib/aiParse.js'
import { formatDuration, toTimeInput, fromInputs, toDateInput } from '../lib/dates.js'
import { PRIORITIES, DEFAULT_PRIORITY } from '../lib/priority.js'
import { findDefaultCalendar, findListForPriority } from '../lib/defaults.js'

const DURATION_OPTIONS = [20, 30, 45, 50, 60, 90, 120]

// Tempo de pausa na digitação antes de acionar a IA sozinha. Curto o
// suficiente para não parecer lento, longo o suficiente para não gastar uma
// chamada por letra digitada.
const AI_DEBOUNCE_MS = 900
const AI_MIN_LENGTH = 4

export default function QuickAdd({ calendars = [], taskLists = [], onCreateEvent, onCreateTask, onDone }) {
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

  // A IA roda sozinha depois de uma pausa na digitação, sem exigir clique: o
  // parser local já preenche a prévia na hora, e a IA a substitui assim que
  // fica pronta, sem travar a tela nem gastar uma chamada por letra.
  async function askAI(value) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setAsking(true)
    setAiFailed(false)
    try {
      const parsed = await parseWithAI(value, calendars, { signal: controller.signal })
      if (controller.signal.aborted) return
      applyPreview(parsed)
      setUsedAI(true)
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
    clearTimeout(debounceRef.current)
    abortRef.current?.abort()
    const preferred = findDefaultCalendar(calendars)
    setCalendarId(preferred ? preferred.id : '')
  }

  async function handleConfirm() {
    if (!preview) return
    setSaving(true)
    setError(null)
    try {
      if (isEvent) {
        const start = fromInputs(toDateInput(preview.start), startTime)
        const end = new Date(start.getTime() + minutes * 60000)
        await onCreateEvent({ ...preview, start, end, calendarId })
      } else {
        await onCreateTask({ ...preview, priority, tasklistId })
      }
      resetDefaults()
      onDone && onDone()
    } catch (err) {
      setError(`Não deu para salvar: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {/* O painel só abre no clique, então o campo já chega com o cursor
          dentro: abrir e ter que clicar de novo era um toque a mais em toda
          tarefa criada. */}
      <input
        type="text"
        autoFocus
        placeholder="Ex: Reunião de equipe terça 13h15 por 50min"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        style={{ width: '100%' }}
      />

      {preview && (
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
            className="primary"
            style={{ marginTop: 10 }}
            onClick={handleConfirm}
            disabled={saving || needsCalendar || needsList}
          >
            {saving ? 'Salvando...' : isEvent ? 'Criar compromisso' : 'Criar tarefa'}
          </button>
        </div>
      )}
    </div>
  )
}
