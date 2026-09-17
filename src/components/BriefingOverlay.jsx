import Modal from './Modal.jsx'
import { formatDuration } from '../lib/dates.js'

const KIND_LABEL = {
  dia_manha: 'Briefing da manhã',
  dia_tarde: 'Briefing da tarde',
  dia_recap: 'Resumo do dia',
  semana_inicio: 'Semana que começa',
  semana_fim: 'Semana que passou',
}

// Só o que faz sentido mostrar como número — compromissosTotais entra na
// conta da IA (context) mas não vira cartão próprio, para não repetir
// "compromissos com presença" e "compromissos totais" lado a lado.
const STAT_LABEL = {
  tarefasConcluidas: 'Tarefas concluídas',
  blocosDeFoco: 'Blocos de foco',
  minutosDeFoco: 'Minutos de foco',
  compromissosComparecidos: 'Compromissos com presença',
}

// A tela sobreposta e esmaecida do briefing — reaproveita o Modal (mesmo
// fundo escurecido, Escape/clique fora fecham) em vez de um componente à
// parte. No briefing de fim de semana, os números viram um pequeno painel
// (o "formato de dashboard" pedido) em vez de só texto corrido.
export default function BriefingOverlay({ briefing, onClose }) {
  if (!briefing) return null

  return (
    <Modal title={KIND_LABEL[briefing.kind] || 'Briefing'} onClose={onClose}>
      <p style={{ fontSize: 'var(--body-md)', lineHeight: 1.5, margin: 0 }}>
        {briefing.text || 'Sem nada de especial para contar por agora.'}
      </p>

      {briefing.stats && (
        <div className="briefing-stats">
          {Object.entries(STAT_LABEL).map(([key, label]) => (
            <div key={key} className="briefing-stat">
              <div className="briefing-stat-value">
                {key === 'minutosDeFoco' ? formatDuration(briefing.stats[key] || 0) : briefing.stats[key] ?? 0}
              </div>
              <div className="briefing-stat-label">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="modal-actions">
        <button type="button" className="primary" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  )
}
