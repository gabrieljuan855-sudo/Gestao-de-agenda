import { useEffect, useState } from 'react'
import Modal from './Modal.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { toDateInput, toTimeInput, fromInputs } from '../lib/dates.js'
import { isAllDay, eventStart, eventEnd } from '../lib/events.js'
import { PROJETO_PROP } from '../lib/projetos.js'
import {
  lerRecorrencia,
  montarRecorrencia,
  regraDaOpcao,
  acompanharData,
} from '../lib/recorrencia.js'
import Repeticao from './Repeticao.jsx'
import EscopoDaSerie from './EscopoDaSerie.jsx'

// O link de vídeo pode estar em dois lugares do evento, dependendo de como
// ele nasceu: hangoutLink é o atalho que o próprio Google mantém por
// compatibilidade; conferenceData.entryPoints é o formato atual e mais
// completo (às vezes tem também telefone, sala, etc. — aqui só o vídeo
// importa).
function linkDaVideochamada(event) {
  return event.hangoutLink || event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || null
}

export default function EventEditor({ event, calendars = [], projetos = [], carregarSerie, onSave, onDelete, onClose }) {
  const allDay = isAllDay(event)
  const start = eventStart(event)
  const end = eventEnd(event)
  // Uma ocorrência de série não traz a regra de repetição — só a série tem.
  // Ela é buscada ao abrir; até chegar, o seletor fica esperando em vez de
  // mostrar "Não se repete", que era o que a tela dizia antes (errado).
  const recorrente = Boolean(event.recurringEventId)
  const [serie, setSerie] = useState(recorrente ? { status: 'carregando' } : { status: 'ok', evento: event })
  useEffect(() => {
    if (!recorrente || !carregarSerie) return
    let vivo = true
    carregarSerie(event)
      .then((evento) => vivo && setSerie({ status: 'ok', evento }))
      .catch(() => vivo && setSerie({ status: 'erro' }))
    return () => {
      vivo = false
    }
  }, [event, recorrente, carregarSerie])
  const lida = serie.status === 'ok' ? lerRecorrencia(serie.evento.recurrence, start) : null

  const [title, setTitle] = useState(event.summary || '')
  const [date, setDate] = useState(toDateInput(start))
  const [endDate, setEndDate] = useState(toDateInput(end))
  const [startTime, setStartTime] = useState(allDay ? '09:00' : toTimeInput(start))
  const [endTime, setEndTime] = useState(allDay ? '10:00' : toTimeInput(end))
  const [calendarId, setCalendarId] = useState(event.calendarId || 'primary')
  const [description, setDescription] = useState(event.description || '')
  const [location, setLocation] = useState(event.location || '')
  // `null` = ninguém mexeu na repetição; aí ela fica de fora do que é
  // salvo (e só acompanha a data, se a data mudou). Senão, a escolha: uma
  // opção rápida, 'nunca', ou { personalizada: regra }.
  const [repeticao, setRepeticao] = useState(null)
  const projetoInicial = event.extendedProperties?.private?.[PROJETO_PROP] || ''
  const [projeto, setProjeto] = useState(projetoInicial)
  // Vídeo é uma intenção, não um valor editável direto: o link em si só
  // existe depois que o Google responde. Aqui só se guarda "quero criar" ou
  // "quero remover", e o botão junto tem um "Desfazer" antes de salvar.
  const [videoAcao, setVideoAcao] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Série: as escolhas "este / este e os seguintes / todos" aparecem na
  // hora de salvar ou excluir, como no Google — não antes.
  const [perguntaSerie, setPerguntaSerie] = useState(null)

  const linkVideo = linkDaVideochamada(event)

  // A regra que vale com as datas do formulário: a escolhida, se a pessoa
  // mexeu; senão a que já existia, acompanhando a data se ela mudou.
  function regraFinal(nextStart) {
    if (repeticao === 'nunca') return { recurrence: [], escolhida: true }
    if (repeticao?.personalizada) return { recurrence: montarRecorrencia(repeticao.personalizada, lida?.extras, allDay), escolhida: true }
    if (repeticao) return { recurrence: montarRecorrencia(regraDaOpcao(repeticao, nextStart), lida?.extras, allDay), escolhida: true }
    if (!lida?.regra) return { recurrence: undefined, escolhida: false }
    const seguida = acompanharData(lida.regra, start, nextStart)
    if (seguida === lida.regra) return { recurrence: undefined, escolhida: false }
    return { recurrence: montarRecorrencia(seguida, lida.extras, allDay), escolhida: false }
  }

  function montarPatch() {
    const nextStart = allDay ? fromInputs(date) : fromInputs(date, startTime)
    const nextEnd = allDay ? fromInputs(endDate) : fromInputs(date, endTime)
    if (nextEnd <= nextStart) {
      setError(allDay ? 'O último dia não pode ser antes do primeiro.' : 'O fim precisa ser depois do início.')
      return null
    }
    const { recurrence, escolhida } = regraFinal(nextStart)
    return {
      title: title.trim(),
      start: nextStart,
      end: nextEnd,
      allDay,
      calendarId,
      description,
      location,
      // Sem mudança na repetição, `recurrence` fica de fora do patch —
      // inclusive quando a regra é uma que o editor não sabe montar: salvar
      // o título não pode apagar uma repetição que ninguém pediu para mudar.
      ...(recurrence === undefined ? {} : { recurrence }),
      recorrenciaEscolhida: escolhida,
      // Mesmo cuidado da repetição: só entra no patch se a pessoa mexeu.
      ...(projeto === projetoInicial ? {} : { projeto }),
      ...(videoAcao === 'adicionar' ? { criarVideochamada: true } : {}),
      ...(videoAcao === 'remover' ? { removerVideochamada: true } : {}),
    }
  }

  function handleSave() {
    setError(null)
    const patch = montarPatch()
    if (!patch) return
    if (!recorrente) {
      // Um evento simples que passa a se repetir não tem o que perguntar.
      salvar(patch, 'este')
      return
    }
    // Como no Google: mudar a regra ou a agenda não vale para uma ocorrência
    // sozinha — aí "Este evento" nem aparece.
    const semEste = patch.recorrenciaEscolhida || patch.calendarId !== (event.calendarId || 'primary')
    setPerguntaSerie({ acao: 'salvar', patch, semEste })
  }

  async function salvar(patch, escopo) {
    setSaving(true)
    try {
      await onSave(patch, escopo)
      onClose()
    } catch (err) {
      setError(`Não deu para salvar: ${err.message}`)
      setSaving(false)
    }
  }

  async function handleDelete(escopo = 'este') {
    setSaving(true)
    try {
      await onDelete(escopo)
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

        <Repeticao
          data={fromInputs(date)}
          status={recorrente ? serie.status : 'ok'}
          lida={lida}
          escolha={repeticao}
          onEscolha={setRepeticao}
        />

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

        {(projetos.length > 0 || projetoInicial) && (
          <label className="field">
            <span>Projeto</span>
            <select value={projeto} onChange={(e) => setProjeto(e.target.value)}>
              <option value="">Nenhum</option>
              {projetoInicial && !projetos.some((p) => p.id === projetoInicial) && (
                <option value={projetoInicial}>{projetoInicial}</option>
              )}
              {projetos.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </label>
        )}

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
          <button
            type="button"
            onClick={() => (recorrente ? setPerguntaSerie({ acao: 'excluir' }) : setConfirmingDelete(true))}
            disabled={saving}
            className="danger"
          >
            Excluir
          </button>
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

      {perguntaSerie && (
        <EscopoDaSerie
          acao={perguntaSerie.acao}
          semEste={perguntaSerie.semEste}
          onConfirm={(escopo) => {
            const pergunta = perguntaSerie
            setPerguntaSerie(null)
            if (pergunta.acao === 'excluir') handleDelete(escopo)
            else salvar(pergunta.patch, escopo)
          }}
          onCancel={() => setPerguntaSerie(null)}
        />
      )}
    </>
  )
}
