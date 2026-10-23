import { useState } from 'react'
import Modal from './Modal.jsx'

// A pergunta do Google ao mexer num evento que se repete: vale só para esta
// ocorrência, para esta e as seguintes, ou para a série inteira? Antes o app
// não perguntava — editar ou excluir mexia só na ocorrência aberta, e não
// havia como mudar a série toda sem ir ao Google.
const OPCOES = [
  { id: 'este', label: 'Este evento' },
  { id: 'seguintes', label: 'Este e os eventos seguintes' },
  { id: 'todos', label: 'Todos os eventos' },
]

export default function EscopoDaSerie({ acao, semEste = false, onConfirm, onCancel }) {
  const opcoes = semEste ? OPCOES.filter((o) => o.id !== 'este') : OPCOES
  const [escolha, setEscolha] = useState(opcoes[0].id)

  return (
    <Modal title={acao === 'excluir' ? 'Excluir evento recorrente' : 'Editar evento recorrente'} onClose={onCancel} elevated>
      <div className="escopo-serie" role="radiogroup">
        {opcoes.map((o) => (
          <label key={o.id} className="radio-linha">
            <input type="radio" name="escopo-serie" value={o.id} checked={escolha === o.id} onChange={() => setEscolha(o.id)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <div className="modal-actions" style={{ justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel}>Cancelar</button>
        <button type="button" className={acao === 'excluir' ? 'danger' : 'primary'} onClick={() => onConfirm(escolha)}>
          {acao === 'excluir' ? 'Excluir' : 'OK'}
        </button>
      </div>
    </Modal>
  )
}
