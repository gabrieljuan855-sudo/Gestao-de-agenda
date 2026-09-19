import { useState } from 'react'
import Modal from './Modal.jsx'
import { horarioPadrao, saveWorkSchedule } from '../lib/schedule.js'

const DIAS = [
  { id: 1, label: 'Segunda' },
  { id: 2, label: 'Terça' },
  { id: 3, label: 'Quarta' },
  { id: 4, label: 'Quinta' },
  { id: 5, label: 'Sexta' },
  { id: 6, label: 'Sábado' },
  { id: 0, label: 'Domingo' },
]

// Editor do expediente por dia da semana, até dois blocos por dia (para o
// intervalo de almoço) — o mesmo formato que schedule.js já guarda, só que
// editável em vez de fixo no código. É o que decide o que a tela Agora conta
// como "tempo livre" e o que o Dia mostra como vão livre.
export default function HorarioTrabalho({ schedule, onChange, onClose }) {
  const [rascunho, setRascunho] = useState(schedule)

  function blocosDoDia(dia) {
    return rascunho[dia] || []
  }

  function mudarBloco(dia, indice, campo, valor) {
    const blocos = blocosDoDia(dia).map((b, i) => (i === indice ? (campo === 0 ? [valor, b[1]] : [b[0], valor]) : b))
    setRascunho({ ...rascunho, [dia]: blocos })
  }

  function alternarDia(dia) {
    const ativo = blocosDoDia(dia).length > 0
    setRascunho({ ...rascunho, [dia]: ativo ? [] : [['08:00', '17:00']] })
  }

  function adicionarIntervalo(dia) {
    const blocos = blocosDoDia(dia)
    if (blocos.length >= 2) return
    setRascunho({ ...rascunho, [dia]: [...blocos, ['13:00', '17:00']] })
  }

  function removerIntervalo(dia) {
    const blocos = blocosDoDia(dia)
    if (blocos.length <= 1) return
    setRascunho({ ...rascunho, [dia]: [blocos[0]] })
  }

  function salvar() {
    saveWorkSchedule(rascunho)
    onChange(rascunho)
    onClose()
  }

  return (
    <Modal title="Horário de trabalho" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {DIAS.map(({ id, label }) => {
          const blocos = blocosDoDia(id)
          return (
            <div key={id}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={blocos.length > 0} onChange={() => alternarDia(id)} />
                {label}
              </label>
              {blocos.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 26, marginTop: 4 }}>
                  {blocos.map((bloco, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="time" value={bloco[0]} onChange={(e) => mudarBloco(id, i, 0, e.target.value)} />
                      <span className="muted">até</span>
                      <input type="time" value={bloco[1]} onChange={(e) => mudarBloco(id, i, 1, e.target.value)} />
                    </div>
                  ))}
                  {blocos.length < 2 && (
                    <button type="button" onClick={() => adicionarIntervalo(id)}>+ intervalo (ex.: almoço)</button>
                  )}
                  {blocos.length > 1 && (
                    <button type="button" onClick={() => removerIntervalo(id)}>remover segundo bloco</button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="button" className="primary" onClick={salvar}>Salvar</button>
        <button type="button" onClick={() => setRascunho(horarioPadrao())}>Restaurar padrão</button>
      </div>
    </Modal>
  )
}
