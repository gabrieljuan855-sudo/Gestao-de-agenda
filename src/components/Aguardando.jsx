import { daysSince } from '../lib/tasks.js'

// As duas listas de "não agora": uma espera resposta de alguém, a outra
// espera a vontade da própria pessoa um dia. Ficam na mesma tela porque as
// duas têm o mesmo formato de uso — reler de vez em quando, reativar quando
// deixar de fazer sentido esperar — bem mais raro que abrir a Entrada ou as
// Próximas ações.
function diasEsperando(aguardando) {
  if (!aguardando?.desde) return null
  return daysSince(aguardando.desde)
}

function Item({ task, subtitulo, onReativar, onConcluir }) {
  return (
    <div className="aguardando-item">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 'var(--body-md)' }}>{task.title}</div>
        {subtitulo && <div className="muted" style={{ fontSize: 'var(--label-sm)' }}>{subtitulo}</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button type="button" onClick={() => onConcluir(task)}>Já fiz</button>
        <button type="button" onClick={() => onReativar(task)}>Reativar</button>
      </div>
    </div>
  )
}

export default function Aguardando({ aguardando = [], algumDia = [], onReativar, onConcluir }) {
  return (
    <div>
      <h3 className="t-title" style={{ marginTop: 0 }}>Aguardando</h3>
      {aguardando.length === 0 ? (
        <p className="muted" style={{ fontSize: 'var(--body-sm)' }}>Ninguém te devendo nada, por enquanto.</p>
      ) : (
        <div className="aguardando-lista">
          {aguardando.map((task) => {
            const dias = diasEsperando(task.aguardando)
            // A partir de 7 dias vale um empurrão: uma espera que passa de
            // uma semana já merece uma cobrança, não só ficar anotada.
            const parada = dias !== null && dias >= 7
            return (
              <Item
                key={task.id}
                task={task}
                onReativar={onReativar}
                onConcluir={onConcluir}
                subtitulo={
                  <span style={{ color: parada ? 'var(--important)' : undefined }}>
                    esperando {task.aguardando?.quem || 'alguém'}
                    {dias !== null && ` · há ${dias} ${dias === 1 ? 'dia' : 'dias'}`}
                  </span>
                }
              />
            )
          })}
        </div>
      )}

      <h3 className="t-title" style={{ marginTop: 20 }}>Algum dia</h3>
      {algumDia.length === 0 ? (
        <p className="muted" style={{ fontSize: 'var(--body-sm)' }}>Nada engavetado agora.</p>
      ) : (
        <div className="aguardando-lista">
          {algumDia.map((task) => (
            <Item key={task.id} task={task} onReativar={onReativar} onConcluir={onConcluir} />
          ))}
        </div>
      )}
    </div>
  )
}
