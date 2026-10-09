import { useEffect, useState } from 'react'
import Modal from './Modal.jsx'
import { ANTECEDENCIAS } from '../lib/lembretes.js'
import { avisosSuportados, mostrarAvisoDeTeste } from '../lib/useLembretes.js'
import { pushSuportado, inscricaoAtual, inscreverNesteAparelho, cancelarNesteAparelho, ehIOS, abertoComoApp } from '../lib/pushAvisos.js'

// Ligar os avisos pede a permissão do navegador na hora do clique — é a
// única hora em que ele deixa pedir, e a pessoa sabe por que está sendo
// perguntada.
function Avisos({ config, onChange }) {
  const [permissao, setPermissao] = useState(() => (avisosSuportados() ? Notification.permission : 'indisponivel'))
  // Estado da inscrição deste aparelho nos avisos com o app fechado.
  const [fechado, setFechado] = useState('verificando')
  const [erroFechado, setErroFechado] = useState(null)

  useEffect(() => {
    if (!pushSuportado()) {
      setFechado('indisponivel')
      return
    }
    inscricaoAtual()
      .then((i) => setFechado(i ? 'ativo' : 'inativo'))
      .catch(() => setFechado('inativo'))
  }, [])

  // Precisa vir de um toque (regra do iPhone): por isso é chamado direto
  // dos cliques, nunca sozinho.
  async function ligarComAppFechado() {
    setErroFechado(null)
    try {
      await inscreverNesteAparelho()
      setFechado('ativo')
      // O hook dos avisos ouve isto e manda a lista da semana na hora.
      window.dispatchEvent(new Event('avisos:inscrito'))
    } catch (err) {
      setErroFechado(`Não deu para ligar: ${err.message}`)
    }
  }

  async function alternar(ativo) {
    if (ativo && permissao !== 'granted') {
      const r = await Notification.requestPermission()
      setPermissao(r)
      if (r !== 'granted') return
    }
    onChange({ ...config, ativo })
    if (ativo) {
      // Um aviso de exemplo na hora: confirma que o sistema não está
      // silenciando as notificações (modo foco, "Não perturbe").
      mostrarAvisoDeTeste()
      if (pushSuportado()) ligarComAppFechado()
    } else {
      cancelarNesteAparelho().finally(() => setFechado(pushSuportado() ? 'inativo' : 'indisponivel'))
    }
  }

  // No iPhone, notificação de site só existe no app aberto pela Tela de
  // Início — no Safari comum nem a permissão aparece.
  if (permissao === 'indisponivel') {
    return (
      <p className="muted" style={{ margin: 0 }}>
        {ehIOS() && !abertoComoApp()
          ? 'No iPhone, os avisos funcionam no app da Tela de Início: no Safari, toque em Compartilhar → "Adicionar à Tela de Início", abra o app por lá e ligue os avisos aqui.'
          : 'Este navegador não mostra notificações. No computador, use Chrome, Edge, Firefox ou Safari.'}
      </p>
    )
  }

  const ligado = config.ativo && permissao === 'granted'

  return (
    <div className="avisos-config">
      <label className="calendar-toggle">
        <input type="checkbox" checked={ligado} onChange={(e) => alternar(e.target.checked)} />
        <strong>Avisar antes dos compromissos</strong>
      </label>
      {permissao === 'denied' && (
        <p className="form-error" style={{ margin: 0 }}>
          {ehIOS()
            ? 'As notificações estão bloqueadas. Libere em Ajustes → Notificações → Segundo Cérebro e marque de novo.'
            : 'O navegador está bloqueando as notificações deste site. Libere no cadeado ao lado do endereço e marque de novo.'}
        </p>
      )}
      {ligado && (
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
      {ligado && fechado === 'ativo' && (
        <p className="muted" style={{ margin: 0, fontSize: 'var(--label-md)' }}>
          ✓ Avisa mesmo com o app fechado, com a agenda dos próximos 8 dias. Abra o app de vez em quando para a lista
          andar para a frente.
        </p>
      )}
      {ligado && fechado === 'inativo' && (
        <div className="avisos-linha">
          <span className="muted" style={{ flex: 1, fontSize: 'var(--label-md)' }}>Por enquanto, só avisa com o app aberto.</span>
          <button type="button" onClick={ligarComAppFechado}>Avisar com o app fechado</button>
        </div>
      )}
      {ligado && fechado === 'indisponivel' && (
        <p className="muted" style={{ margin: 0, fontSize: 'var(--label-md)' }}>
          Funciona com o app aberto — numa aba, mesmo em segundo plano, ou instalado.
        </p>
      )}
      {erroFechado && <p className="form-error" style={{ margin: 0 }}>{erroFechado}</p>}
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
