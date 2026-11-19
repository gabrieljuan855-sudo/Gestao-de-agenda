import { useState } from 'react'
import FotoDaPeca from './FotoDaPeca.jsx'
import { USEI, NAO_GOSTEI } from '../lib/guardaRoupa.js'

// O cartão "Roupa do dia" da tela inicial: a combinação que o Claude montou
// para hoje (peças, por que essas e o clima), com a resposta de quem vai
// vestir. "Usei esta" conta o uso de cada peça; "Não gostei" guarda o
// motivo, que o Claude lê antes de montar a próxima. Quando aparece (só de
// manhã cedo) e o "tirar da tela" ficam em roupaDoDiaNaTela.js.
//
// No código e no conector o registro continua se chamando "look"; o nome
// mudou só na tela, para não quebrar as ferramentas nem a tarefa agendada.

function BotaoFechar({ onFechar }) {
  return (
    <button type="button" className="look-fechar" onClick={onFechar} aria-label="Tirar a roupa do dia da tela" title="Tirar da tela até amanhã">
      ×
    </button>
  )
}

export default function RoupaDoDia({ look, pecas, temPecas, onResponder, onAbrirGuardaRoupa, onFechar }) {
  const [explicando, setExplicando] = useState(false)
  const [motivo, setMotivo] = useState('')

  // Sem look: uma linha só, sem ocupar o lugar da agenda.
  if (!look) {
    return (
      <div className="look-do-dia is-vazio">
        <span className="look-rotulo">Roupa do dia</span>
        <span className="muted">
          {temPecas ? 'Ainda não há sugestão para hoje.' : 'Cadastre suas peças para receber uma sugestão toda manhã.'}
        </span>
        <button type="button" className="look-link" onClick={onAbrirGuardaRoupa}>Abrir guarda-roupa</button>
        <BotaoFechar onFechar={onFechar} />
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
    <section className="card look-do-dia" aria-label="Roupa do dia">
      <div className="look-cabeca">
        <h3 className="look-rotulo">Roupa do dia</h3>
        {look.clima && <span className="look-clima">{look.clima}</span>}
        <BotaoFechar onFechar={onFechar} />
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
          {sumiram === 1 ? 'Uma peça desta sugestão foi excluída do guarda-roupa.' : `${sumiram} peças desta sugestão foram excluídas do guarda-roupa.`}
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
            {look.feedback === USEI ? 'Você usou esta combinação.' : `Você não gostou${look.motivo ? `: ${look.motivo}` : '.'}`}
          </span>
          {look.feedback === USEI ? (
            <button type="button" className="look-link" onClick={() => { setMotivo(''); setExplicando(true) }}>Não gostei</button>
          ) : (
            <button type="button" className="look-link" onClick={() => onResponder(look.data, USEI)}>Usei esta</button>
          )}
        </div>
      ) : (
        <div className="look-acoes">
          <button type="button" className="look-link" onClick={() => { setMotivo(''); setExplicando(true) }}>Não gostei</button>
          <button type="button" className="primary" onClick={() => onResponder(look.data, USEI)}>Usei esta</button>
        </div>
      )}
    </section>
  )
}
