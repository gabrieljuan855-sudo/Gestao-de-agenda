import { useState } from 'react'
import Modal from './Modal.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { toDateInput, fromInputs, dateOnlyFromISO } from '../lib/dates.js'
import { PRIORITIES, DEFAULT_PRIORITY } from '../lib/priority.js'
import { separarAnexos, juntarAnexos } from '../lib/anexosNoTexto.js'
import Anexos from './Anexos.jsx'
import { horarioSugerido } from '../lib/conversao.js'
import { erroDoPeriodo } from '../lib/events.js'
import { findDefaultCalendar } from '../lib/defaults.js'

export default function TaskEditor({
  task,
  onSave,
  onDelete,
  onReopen,
  onComplete,
  onClose,
  contextos = [],
  projetos = [],
  onSalvarAnexos,
  garantirPasta,
  calendars = [],
  onAgendar,
}) {
  const [title, setTitle] = useState(task.title || '')
  // dateOnlyFromISO, não `new Date(task.due)`: o prazo vem do Google como
  // meia-noite UTC, e o fuso do Brasil mostrava sempre um dia antes do real.
  const [due, setDue] = useState(task.due ? toDateInput(dateOnlyFromISO(task.due)) : '')
  const [priority, setPriority] = useState(task.priority || DEFAULT_PRIORITY)
  // Contexto, projeto e duração nasceram só na tela da Entrada, e quem errasse
  // ali ficava sem conserto: a tarefa guardava a etiqueta para sempre, sem
  // nenhum caminho na interface para mexer nela. Editar é aqui.
  const [contexto, setContexto] = useState(task.contexto || '')
  const [projeto, setProjeto] = useState(task.projeto || '')
  const [duracao, setDuracao] = useState(task.duracao ? String(task.duracao) : '')
  // Os anexos vêm do próprio texto da tarefa (ver anexosNoTexto.js): o campo
  // mostra só o texto, e os arquivos aparecem como lista embaixo.
  const [separado] = useState(() => separarAnexos(task.notesClean || ''))
  const [notes, setNotes] = useState(separado.texto)
  const [anexos, setAnexos] = useState(separado.anexos)
  const [erroDosAnexos, setErroDosAnexos] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const done = task.status === 'completed'

  // "Agendar" troca o conteúdo desta mesma janela (ver o "Transformar em
  // tarefa" do EventEditor): um diálogo por cima do outro fechava junto no Esc.
  const [agendando, setAgendando] = useState(false)
  const [sugerido] = useState(() => horarioSugerido(task))
  const [diaDoEvento, setDiaDoEvento] = useState(sugerido.data)
  const [inicio, setInicio] = useState(sugerido.inicio)
  const [fim, setFim] = useState(sugerido.fim)
  const [agendaId, setAgendaId] = useState(() => (findDefaultCalendar(calendars) || calendars[0])?.id || 'primary')
  // Vem marcado: quem transforma a tarefa em compromisso quer que ela passe a
  // morar na agenda. Desmarcado, o compromisso vira só o horário reservado
  // para fazer a tarefa, e ela continua na lista.
  const [tirarDaLista, setTirarDaLista] = useState(true)

  function agendar() {
    const start = fromInputs(diaDoEvento, inicio)
    const end = fromInputs(diaDoEvento, fim)
    const erro = erroDoPeriodo(start, end, false)
    if (erro) {
      setError(erro)
      return
    }
    run(() => onAgendar({ titulo: title.trim(), start, end, calendarId: agendaId, tirarDaLista }))
  }

  async function run(action, after) {
    setSaving(true)
    setError(null)
    try {
      await action()
      if (after) after()
      onClose()
    } catch (err) {
      setError(`Não deu certo: ${err.message}`)
      setSaving(false)
    }
  }

  function handleSave() {
    run(() =>
      onSave({
        title: title.trim(),
        due: due ? fromInputs(due) : null,
        priority,
        notes: juntarAnexos(notes, anexos),
        // `null`, e não string vazia: é assim que se apaga uma etiqueta que
        // não faz mais sentido (ver o merge por `!== undefined` em updateTask).
        contexto: contexto.trim() || null,
        projeto: projeto.trim() || null,
        duracao: duracao ? Number(duracao) : null,
      })
    )
  }

  // Anexo grava na hora, sem esperar o "Salvar": o arquivo já está no Drive,
  // e fechar o editor sem salvar o deixaria lá sem ligação com a tarefa. Vai
  // com o texto como estava salvo — o que está sendo digitado continua
  // esperando o "Salvar".
  async function mudarAnexos(lista) {
    setAnexos(lista)
    setErroDosAnexos(null)
    try {
      await onSalvarAnexos(juntarAnexos(separado.texto, lista))
    } catch {
      setErroDosAnexos('O arquivo foi para o Drive, mas não deu para ligá-lo à tarefa. Clique em Salvar para tentar de novo.')
    }
  }

  function handleDelete() {
    run(onDelete)
  }

  if (agendando) {
    return (
      <Modal title="Agendar tarefa" onClose={onClose}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            agendar()
          }}
        >
          <label className="field">
            <span>Título do compromisso</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>Data</span>
            <input type="date" value={diaDoEvento} onChange={(e) => setDiaDoEvento(e.target.value)} />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Início</span>
              <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </label>
            <label className="field">
              <span>Fim</span>
              <input type="time" value={fim} onChange={(e) => setFim(e.target.value)} />
            </label>
          </div>
          {calendars.length > 0 && (
            <label className="field">
              <span>Agenda</span>
              <select value={agendaId} onChange={(e) => setAgendaId(e.target.value)}>
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>{cal.summaryOverride || cal.summary}</option>
                ))}
              </select>
            </label>
          )}
          <label className="conversao-marcar">
            <input type="checkbox" checked={tirarDaLista} onChange={(e) => setTirarDaLista(e.target.checked)} />
            <span>
              Tirar a tarefa da lista
              <small>
                {tirarDaLista
                  ? 'O texto e os anexos da tarefa vão para a descrição do compromisso.'
                  : 'A tarefa continua na lista; o compromisso é o horário reservado para fazê-la.'}
              </small>
            </span>
          </label>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" onClick={() => { setError(null); setAgendando(false) }} disabled={saving}>Voltar</button>
            <div style={{ flex: 1 }} />
            <button type="submit" className="primary" disabled={saving || !title.trim()}>
              {saving ? 'Agendando...' : 'Agendar'}
            </button>
          </div>
        </form>
      </Modal>
    )
  }

  return (
    <>
      <Modal title="Editar tarefa" onClose={onClose}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSave()
          }}
        >
        <label className="field">
          <span>Título</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Prazo</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="field">
            <span>Duração (min)</span>
            <input
              type="number"
              min="1"
              placeholder="opcional"
              value={duracao}
              onChange={(e) => setDuracao(e.target.value)}
            />
          </label>
        </div>

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

        {/* Datalist, e não uma lista de botões: o que já existe fica a um
            toque, mas continua dando para digitar um novo — e para apagar. */}
        <div className="field-row">
          <label className="field">
            <span>Contexto</span>
            <input
              type="text"
              placeholder="ligar, computador..."
              value={contexto}
              onChange={(e) => setContexto(e.target.value)}
              list="editor-contextos"
            />
            <datalist id="editor-contextos">
              {contextos.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Projeto</span>
            <input
              type="text"
              placeholder="caso-silva..."
              value={projeto}
              onChange={(e) => setProjeto(e.target.value)}
              list="editor-projetos"
            />
            <datalist id="editor-projetos">
              {projetos.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
        </div>

        <label className="field">
          <span>Anotações</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {onSalvarAnexos && garantirPasta && (
          <div className="field">
            <span>Arquivos{anexos.length ? ` · ${anexos.length}` : ''}</span>
            <Anexos
              arquivos={anexos}
              onMudar={mudarAnexos}
              garantirPasta={() => garantirPasta(projeto.trim() || null)}
              permitirCriar={false}
              dica="Arraste, cole ou anexe: vão para a pasta do projeto da tarefa no Drive."
            />
            {erroDosAnexos && <div className="form-error">{erroDosAnexos}</div>}
          </div>
        )}

        {task.tasklistTitle && (
          <div className="muted" style={{ fontSize: 'var(--label-sm)' }}>Lista: {task.tasklistTitle}</div>
        )}

        {onAgendar && !done && (
          <button type="button" className="conversao-botao" onClick={() => { setError(null); setAgendando(true) }} disabled={saving}>
            <span aria-hidden="true">⇄</span> Agendar na agenda
          </button>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" onClick={() => setConfirmingDelete(true)} disabled={saving} className="danger">Excluir</button>
          <div style={{ flex: 1 }} />
          {done ? (
            <button type="button" onClick={() => run(onReopen)} disabled={saving}>Reabrir</button>
          ) : (
            <button type="button" onClick={() => run(onComplete)} disabled={saving}>Concluir</button>
          )}
          <button type="submit" className="primary" disabled={saving || !title.trim()}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
        </form>
      </Modal>

      {confirmingDelete && (
        <ConfirmDialog
          title="Excluir tarefa"
          message={`Excluir a tarefa "${task.title}"?`}
          confirmLabel="Excluir"
          danger
          onConfirm={() => {
            setConfirmingDelete(false)
            handleDelete()
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  )
}
