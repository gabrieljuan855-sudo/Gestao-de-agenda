import { isToday, addDays, isSameDay } from '../lib/dates.js'
import { montarLista, quandoNaLista, DIAS_DA_LISTA } from '../lib/listaAgenda.js'
import { corDaAgenda } from '../lib/corDaAgenda.js'

function rotuloDoDia(dia) {
  const data = dia.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  if (isToday(dia)) return `Hoje · ${data}`
  if (isSameDay(dia, addDays(new Date(), 1))) return `Amanhã · ${data}`
  return data
}

// Tudo o que está marcado daqui para a frente, dia a dia, numa lista só — o
// jeito de responder "o que eu tenho na AEPETI?" sem folhear semana por
// semana. Com o filtro de agenda (App.jsx), vira a lista de uma agenda só.
export default function ListaView({ reference, events, agenda, onSelectEvent, declined = () => false }) {
  const grupos = montarLista(events, reference)
  const total = grupos.reduce((soma, g) => soma + g.itens.length, 0)

  return (
    <div className="card lista-agenda">
      <div className="muted" style={{ marginBottom: 10 }}>
        Próximos {DIAS_DA_LISTA} dias · {total} {total === 1 ? 'compromisso' : 'compromissos'}
        {agenda ? ` na agenda ${agenda.summaryOverride || agenda.summary}` : ''}
      </div>

      {grupos.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Nada marcado {agenda ? 'nesta agenda ' : ''}nos próximos {DIAS_DA_LISTA} dias.
        </p>
      )}

      {grupos.map((grupo) => (
        <section key={grupo.dia.toISOString()} className="lista-dia">
          <h3 className={`lista-dia-titulo${isToday(grupo.dia) ? ' is-hoje' : ''}`}>{rotuloDoDia(grupo.dia)}</h3>
          {grupo.itens.map((item) => {
            const { event } = item
            return (
              <button
                key={`${event.calendarId}-${event.id}`}
                type="button"
                className={`lista-item${declined(event) ? ' is-declined' : ''}`}
                onClick={() => onSelectEvent && onSelectEvent(event)}
              >
                <span className="lista-item-quando">{quandoNaLista(item)}</span>
                <span className="lista-item-cor" style={{ background: corDaAgenda(event.calendarColor) }} />
                <span className="lista-item-texto">
                  <span className="lista-item-titulo">{event.summary || '(sem título)'}</span>
                  {(event.location || !agenda) && (
                    <span className="lista-item-detalhe">
                      {[!agenda && event.calendarSummary, event.location].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}
