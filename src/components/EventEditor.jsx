import { useState } from 'react'
import Modal from './Modal.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { toDateInput, toTimeInput, fromInputs } from '../lib/dates.js'
import { isAllDay, eventStart, eventEnd } from '../lib/events.js'
import { REPETICOES, REPETICAO_PERSONALIZADA, construirRecorrencia, reconhecerRecorrencia } from '../lib/recorrencia.js'

// O link de vídeo pode estar em dois lugares do evento, dependendo de como
// ele nasceu: hangoutLink é o atalho que o próprio Google mantém por
// compatibilidade; conferenceData.entryPoints é o formato atual e mais
// completo (às vezes tem também telefone, sala, etc. — aqui só o vídeo
// importa).
function linkDaVideochamada(event) {
  return event.hangoutLink || event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || null
}

export default function EventEditor({ event, calendars = [], onSave, onDelete, onClose }) {
  const allDay = isAllDay(event)
  const start = eventStart(event)
  const end = eventEnd(event)
  // Uma regra que o seletor abaixo não sabe reproduzir (feita na Agenda do
  // Google, ou com INTERVAL/COUNT/UNTIL) vira "personalizada" — guardada à
  // parte para eu saber a diferença entre "não mexeu" e "escolheu de novo a
  // mesma coisa que já tinha por acaso".
  const repeticaoInicial = reconhecerRecorrencia(event.recurrence)

  const [title, setTitle] = useState(event.summary || '')
  const [date, setDate] = useState(toDateInput(start))
  const [endDate, setEndDate] = useState(toDateInput(end))
  const [startTime, setStartTime] = useState(allDay ? '09:00' : toTimeInput(start))
  const [endTime, setEndTime] = useState(allDay ? '10:00' : toTimeInput(end))
  const [calendarId, setCalendarId] = useState(event.calendarId || 'primary')
  const [description, setDescription] = useState(event.description || '')
  const [location, setLocation] = useState(event.location || '')
  const [repeticao, setRepeticao] = useState(repeticaoInicial)
  // Vídeo é uma intenção, não um valor editável direto: o link em si só
  // existe depois que o Google responde. Aqui só se guarda "quero criar" ou
  // "quero remover", e o botão junto tem um "Desfazer" antes de salvar.
  const [videoAcao, setVideoAcao] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const linkVideo = linkDaVideochamada(event)

  async function handleSave() {
    const nextStart = allDay ? fromInputs(date) : fromInputs(date, startTime)
    const nextEnd = allDay ? fromInputs(endDate) : fromInputs(date, endTime)

    if (nextEnd <= nextStart) {
      setError(allDay ? 'O último dia não pode ser antes do primeiro.' : 'O fim precisa ser depois do início.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave({
        title: title.trim(),
        start: nextStart,
        end: nextEnd,
        allDay,
        calendarId,
        description,
        location,
        // Sem mudança nenhuma na repetição, `recurrence` fica de fora do
        // patch — inclusive quando ela já era "personalizada": sem essa
        // ressalva, salvar qualquer outro campo (título, local...) apagaria
        // sem querer uma regra que o seletor não sabe reconstruir.
        ...(repeticao === repeticaoInicial
          ? {}
          : { recurrence: repeticao === 'nunca' ? [] : construirRecorrencia(repeticao, nextStart) }),
        ...(videoAcao === 'adicionar' ? { criarVideochamada: true } : {}),
        ...(videoAcao === 'remover' ? { removerVideochamada: true } : {}),
      })
      onClose()
    } catch (err) {
      setError(`Não deu para salvar: ${err.message}`)
      setSaving(false)
    }
  }

  async function handleDelete() {
    setSaving(true)
    try {
      await onDelete()
      onClose()
    } catch (err) {
      setError(`Não deu para excluir: ${err.message}`)
      setSaving(false)
    }
  }

  return (
    <>
      <Modal title="Editar compromisso" onClose={onClose}>
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

        {allDay ? (
          <div className="field-row">
            <label className="field">
              <span>Primeiro dia</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Último dia</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
        ) : (
          <>
            <label className="field">
              <span>Data</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Início</span>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </label>
              <label className="field">
                <span>Fim</span>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </label>
            </div>
          </>
        )}

        <label className="field">
          <span>Repetir</span>
          <select value={repeticao} onChange={(e) => setRepeticao(e.target.value)}>
            {/* Só aparece enquanto for a regra que já veio no evento — trocar
                para outra opção substitui e a "personalizada" não volta mais
                ao seletor, mesmo que se escolha "Não repete" e depois volte. */}
            {repeticaoInicial === 'personalizada' && (
              <option value="personalizada">{REPETICAO_PERSONALIZADA.label}</option>
            )}
            {REPETICOES.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Local</span>
          <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Endereço ou nome do lugar (opcional)" />
        </label>

        <label className="field">
          <span>Descrição</span>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalhes, pauta, link (opcional)" />
        </label>

        <div className="field">
          <span>Videoconferência</span>
          {linkVideo && videoAcao !== 'remover' && (
            <div className="field-row" style={{ alignItems: 'center', gap: 8 }}>
              <a href={linkVideo} target="_blank" rel="noreferrer">Abrir Google Meet</a>
              <button type="button" onClick={() => setVideoAcao('remover')}>Remover</button>
            </div>
          )}
          {videoAcao === 'remover' && (
            <div className="field-row" style={{ alignItems: 'center', gap: 8 }}>
              <span className="muted">O Google Meet será removido ao salvar.</span>
              <button type="button" onClick={() => setVideoAcao(null)}>Desfazer</button>
            </div>
          )}
          {!linkVideo && videoAcao !== 'adicionar' && (
            <button type="button" onClick={() => setVideoAcao('adicionar')}>Adicionar Google Meet</button>
          )}
          {videoAcao === 'adicionar' && (
            <div className="field-row" style={{ alignItems: 'center', gap: 8 }}>
              <span className="muted">O Google Meet será criado ao salvar.</span>
              <button type="button" onClick={() => setVideoAcao(null)}>Desfazer</button>
            </div>
          )}
        </div>

        {calendars.length > 0 && (
          <label className="field">
            <span>Agenda</span>
            <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              {/* A agenda de origem pode não estar entre as graváveis (ex.: uma
                  agenda que virou só-leitura depois que o evento foi criado
                  nela) — sem esta opção extra, o <select> cairia na primeira
                  da lista sozinho e moveria o evento sem ninguém escolher. */}
              {!calendars.some((cal) => cal.id === calendarId) && (
                <option value={calendarId}>{event.calendarSummary || 'Agenda atual'}</option>
              )}
              {calendars.map((cal) => (
                <option key={cal.id} value={cal.id}>{cal.summaryOverride || cal.summary}</option>
              ))}
            </select>
          </label>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" onClick={() => setConfirmingDelete(true)} disabled={saving} className="danger">Excluir</button>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="primary" disabled={saving || !title.trim()}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
        </form>
      </Modal>

      {confirmingDelete && (
        <ConfirmDialog
          title="Excluir compromisso"
          message={`Excluir "${event.summary}" da sua agenda?`}
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
