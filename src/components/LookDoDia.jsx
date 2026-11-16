import { useState } from 'react'
import FotoDaPeca from './FotoDaPeca.jsx'
import { USEI, NAO_GOSTEI } from '../lib/guardaRoupa.js'

// O cartão da tela inicial: o look que o Claude montou para hoje (peças,
// por que essas e o clima), com a resposta de quem vai vestir. "Usei este"
// conta o uso de cada peça; "Não gostei" guarda o motivo, que o Claude lê
// antes de montar o próximo.
export default function LookDoDia({ look, pecas, temPecas, onResponder, onAbrirGuardaRoupa }) {
  const [explicando, setExplicando] = useState(false)
  const [motivo, setMotivo] = useState('')

  // Sem look: uma linha só, sem ocupar o lugar da agenda.
  if (!look) {
    return (
      <div className="look-do-dia is-vazio">
        <span className="look-rotulo">Look do dia</span>
        <span className="muted">
          {temPecas ? 'Ainda não há sugestão para hoje.' : 'Cadastre suas peças para receber uma sugestão toda manhã.'}
        </span>
        <button type="button" className="look-link" onClick={onAbrirGuardaRoupa}>Abrir guarda-roupa</button>
      </div>
    )
  }

  const porId = new Map(pecas.map((p) => [p.id, p]))
  const doLook = look.pecas.map((id) => porId.get(id)).filter(Boolean)
  const sumiram = look.pecas.length - doLook.length

  function naoGostei(e) {
    e.preventDefault()
    onResponder(look.data, NAO_GOSTEI, motivo)
    setExplicando(false)
  }

  return (
    <section className="card look-do-dia" aria-label="Look do dia">
      <div className="look-cabeca">
        <h3 className="look-rotulo">Look do dia</h3>
        {look.clima && <span className="look-clima">{look.clima}</span>}
      </div>

      <ul className="look-pecas">
        {doLook.map((p) => (
          <li key={p.id}>
            <FotoDaPeca peca={p} />
            <span>{p.nome || 'Sem nome'}</span>
          </li>
        ))}
      </ul>
      {sumiram > 0 && (
        <p className="muted t-label look-aviso">
          {sumiram === 1 ? 'Uma peça deste look foi excluída do guarda-roupa.' : `${sumiram} peças deste look foram excluídas do guarda-roupa.`}
        </p>
      )}

      {look.texto && <p className="look-texto">{look.texto}</p>}

      {explicando ? (
        <form className="look-motivo" onSubmit={naoGostei}>
          <label className="field">
            <span>O que não agradou? (opcional)</span>
            <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} autoFocus placeholder="Ex.: quente demais para hoje" />
          </label>
          <div className="look-acoes">
            <button type="button" className="look-link" onClick={() => setExplicando(false)}>Cancelar</button>
            <button type="submit" className="primary">Registrar</button>
          </div>
        </form>
      ) : look.feedback ? (
        <div className="look-acoes" role="status">
          <span className="look-resposta">
            {look.feedback === USEI ? 'Você usou este look.' : `Você não gostou${look.motivo ? `: ${look.motivo}` : '.'}`}
          </span>
          {look.feedback === USEI ? (
            <button type="button" className="look-link" onClick={() => { setMotivo(''); setExplicando(true) }}>Não gostei</button>
          ) : (
            <button type="button" className="look-link" onClick={() => onResponder(look.data, USEI)}>Usei este</button>
          )}
        </div>
      ) : (
        <div className="look-acoes">
          <button type="button" className="look-link" onClick={() => { setMotivo(''); setExplicando(true) }}>Não gostei</button>
          <button type="button" className="primary" onClick={() => onResponder(look.data, USEI)}>Usei este</button>
        </div>
      )}
    </section>
  )
}
