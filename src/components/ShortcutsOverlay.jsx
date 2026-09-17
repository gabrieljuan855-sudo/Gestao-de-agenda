import Modal from './Modal.jsx'
import { ATALHOS } from '../lib/atalhos.js'

// A lista dos atalhos, aberta pelo "?". Reaproveita o Modal como o briefing
// faz. Existe porque atalho que não aparece em lugar nenhum é atalho que
// ninguém descobre — o title de cada botão do trilho é a outra metade disso.
export default function ShortcutsOverlay({ onClose }) {
  return (
    <Modal title="Atalhos de teclado" onClose={onClose}>
      <ul className="atalhos-lista">
        {ATALHOS.map((a) => (
          <li key={a.acao} className="atalhos-item">
            <span className="atalhos-teclas">
              <kbd>{a.tecla}</kbd>
              {a.alias && (
                <>
                  {' ou '}
                  <kbd>{a.alias}</kbd>
                </>
              )}
            </span>
            <span>{a.descricao}</span>
          </li>
        ))}
        <li className="atalhos-item">
          <span className="atalhos-teclas"><kbd>Esc</kbd></span>
          <span>Fechar o que estiver aberto</span>
        </li>
      </ul>

      <p className="muted" style={{ fontSize: 'var(--label-sm)', marginTop: 12 }}>
        Os atalhos ficam quietos enquanto você digita num campo.
      </p>

      <div className="modal-actions">
        <button type="button" className="primary" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  )
}
