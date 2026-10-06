import { useState } from 'react'
import Modal from './Modal.jsx'
import { ANTECEDENCIAS } from '../lib/lembretes.js'
import { avisosSuportados, mostrarAvisoDeTeste } from '../lib/useLembretes.js'

// Ligar os avisos pede a permissão do navegador na hora do clique — é a
// única hora em que ele deixa pedir, e a pessoa sabe por que está sendo
// perguntada.
function Avisos({ config, onChange }) {
  const [permissao, setPermissao] = useState(() => (avisosSuportados() ? Notification.permission : 'indisponivel'))

  async function alternar(ativo) {
    if (ativo && permissao !== 'granted') {
      const r = await Notification.requestPermission()
      setPermissao(r)
      if (r !== 'granted') return
    }
    onChange({ ...config, ativo })
    // Um aviso de exemplo na hora: confirma que o sistema não está
    // silenciando as notificações do navegador (modo foco, "Não perturbe").
    if (ativo) mostrarAvisoDeTeste()
  }

  if (permissao === 'indisponivel') {
    return <p className="muted" style={{ margin: 0 }}>Este navegador não mostra notificações. No computador, use Chrome, Edge, Firefox ou Safari.</p>
  }

  return (
    <div className="avisos-config">
      <label className="calendar-toggle">
        <input type="checkbox" checked={config.ativo && permissao === 'granted'} onChange={(e) => alternar(e.target.checked)} />
        <strong>Avisar no computador antes dos compromissos</strong>
      </label>
      {permissao === 'denied' && (
        <p className="form-error" style={{ margin: 0 }}>
          O navegador está bloqueando as notificações deste site. Libere no cadeado ao lado do endereço e marque de novo.
        </p>
      )}
      {config.ativo && permissao === 'granted' && (
        <div className="avisos-linha">
          <label className="field" style={{ flex: 1 }}>
            <span>Quando</span>
            <select
              value={String(config.antecedencia)}
              onChange={(e) => onChange({ ...config, antecedencia: e.target.value === 'google' ? 'google' : Number(e.target.value) })}
            >
              {ANTECEDENCIAS.map((m) => (
                <option key={m} value={m}>{m < 60 ? `${m} minutos antes` : '1 hora antes'}</option>
              ))}
              <option value="google">Seguir os lembretes do Google Agenda</option>
            </select>
          </label>
          <button type="button" onClick={mostrarAvisoDeTeste}>Testar aviso</button>
        </div>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 'var(--label-md)' }}>
        Funciona com o app aberto — numa aba, mesmo em segundo plano, ou instalado. Fechado, não avisa.
      </p>
    </div>
  )
}

export default function CalendarSettings({ calendars, prefs, onChange, avisos, onAvisos, onClose }) {
  function toggle(calendarId, field) {
    const current = prefs[calendarId] || { occupies: true, needsPresence: false, avisa: true }
    onChange({ ...prefs, [calendarId]: { ...current, [field]: !current[field] } })
  }

  return (
    <Modal title="Suas agendas" onClose={onClose}>
      <Avisos config={avisos} onChange={onAvisos} />

      <div className="muted" style={{ fontSize: 'var(--label-md)' }}>
        Agenda que não ocupa tempo continua aparecendo, mas não conta na sua carga
        nem tira os vãos livres do dia.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {calendars.map((calendar) => {
          const pref = prefs[calendar.id] || { occupies: true, needsPresence: false, avisa: true }
          return (
            <div key={calendar.id} className="calendar-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    flexShrink: 0,
                    background: calendar.backgroundColor || 'var(--accent)',
                  }}
                />
                <span style={{ fontSize: 'var(--body-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {calendar.summaryOverride || calendar.summary}
                </span>
              </div>

              <label className="muted calendar-toggle">
                <input
                  type="checkbox"
                  checked={pref.occupies}
                  onChange={() => toggle(calendar.id, 'occupies')}
                />
                ocupa meu tempo
              </label>

              <label className="muted calendar-toggle">
                <input
                  type="checkbox"
                  checked={pref.needsPresence}
                  onChange={() => toggle(calendar.id, 'needsPresence')}
                  disabled={!pref.occupies}
                />
                pergunta se eu vou
              </label>

              {avisos.ativo && (
                <label className="muted calendar-toggle">
                  <input type="checkbox" checked={pref.avisa !== false} onChange={() => toggle(calendar.id, 'avisa')} />
                  me avisa antes
                </label>
              )}
            </div>
          )
        })}
      </div>

      <div className="modal-actions">
        <div style={{ flex: 1 }} />
        <button className="primary" onClick={onClose}>Pronto</button>
      </div>
    </Modal>
  )
}
