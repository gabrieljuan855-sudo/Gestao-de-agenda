import { formatDuration } from '../lib/dates.js'

// A revisão semanal do GTD, sem o ritual: um clique, uma lista de números que
// o app já sabia calcular sozinho, e um comentário de IA por cima — não um
// checklist obrigatório, só a tela pronta para quem quiser usar.
export default function Revisao({ numeros, comentario, carregando, onGerar }) {
  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 10 }}>Revisão da semana</div>

      {!numeros && (
        <>
          <p className="muted" style={{ fontSize: 'var(--body-sm)' }}>
            O que ficou parado, o que está esperando há tempo demais, o que foi para a frente.
          </p>
          <button type="button" className="primary" onClick={onGerar} disabled={carregando}>
            {carregando ? 'Calculando...' : 'Gerar revisão'}
          </button>
        </>
      )}

      {numeros && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comentario && <p style={{ fontSize: 'var(--body-md)', margin: 0 }}>{comentario}</p>}

          <ul
            className="revisao-lista"
            style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--body-sm)' }}
          >
            <li>
              {numeros.entradaVazia
                ? 'Entrada vazia — nada esperando ser esclarecido.'
                : 'Ainda há algo na Entrada esperando ser esclarecido.'}
            </li>
            <li>{numeros.atrasadas === 0 ? 'Nenhuma tarefa atrasada.' : `${numeros.atrasadas} tarefa(s) atrasada(s).`}</li>
            <li>
              {numeros.paradas === 0
                ? 'Nada parado há mais de 3 dias.'
                : `${numeros.paradas} tarefa(s) parada(s) há mais de 3 dias.`}
            </li>
            <li>
              {numeros.projetosParados.length === 0
                ? 'Todo projeto tem alguma próxima ação.'
                : `Projeto(s) sem próxima ação: ${numeros.projetosParados.map((p) => `#${p}`).join(', ')}.`}
            </li>
            <li>
              {numeros.aguardandoEnvelhecendo.length === 0
                ? 'Nenhuma espera com mais de uma semana.'
                : `Esperando há mais de uma semana: ${numeros.aguardandoEnvelhecendo
                    .map((a) => `"${a.title}" (${a.dias}d)`)
                    .join(', ')}.`}
            </li>
            <li>
              {numeros.concluidasNaSemana === 0
                ? 'Nenhuma tarefa concluída ainda esta semana.'
                : `${numeros.concluidasNaSemana} tarefa(s) concluída(s) esta semana.`}
            </li>
            <li>
              {numeros.blocosDeFoco === 0
                ? 'Nenhum bloco de foco esta semana.'
                : `${numeros.blocosDeFoco} bloco(s) de foco, ${formatDuration(numeros.minutosDeFoco)}.`}
            </li>
          </ul>

          <button type="button" onClick={onGerar} disabled={carregando}>
            {carregando ? 'Recalculando...' : 'Recalcular'}
          </button>
        </div>
      )}
    </div>
  )
}
