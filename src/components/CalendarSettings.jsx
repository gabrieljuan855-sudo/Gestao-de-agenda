import Modal from './Modal.jsx'

export default function CalendarSettings({ calendars, prefs, onChange, onClose }) {
  function toggle(calendarId, field) {
    const current = prefs[calendarId] || { occupies: true, needsPresence: false }
    onChange({ ...prefs, [calendarId]: { ...current, [field]: !current[field] } })
  }

  return (
    <Modal title="Suas agendas" onClose={onClose}>
      <div className="muted" style={{ fontSize: 'var(--label-md)' }}>
        Agenda que não ocupa tempo continua aparecendo, mas não conta na sua carga
        nem tira os vãos livres do dia.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {calendars.map((calendar) => {
          const pref = prefs[calendar.id] || { occupies: true, needsPresence: false }
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
