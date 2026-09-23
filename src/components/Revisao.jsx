import { useEffect, useState } from 'react'
import { formatDuration } from '../lib/dates.js'

function dataCurta(iso) {
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

// "09:00" + 45min = "09:45", só para mostrar o fim do bloco na tela — o app
// já usa fromInputs/handleAgendarBloco pra virar evento de verdade.
function somarMinutos(hora, minutos) {
  const [h, m] = hora.split(':').map(Number)
  const total = h * 60 + m + minutos
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// O que o item é, numa linha — para a sugestão ser lida sem abrir nada.
function descreverItem(item) {
  if (item.tipo === 'atrasada') return `"${item.titulo}" · atrasada há ${item.dias} dia(s)`
  if (item.tipo === 'aguardando') return `"${item.titulo}" · esperando ${item.quem} há ${item.dias} dias`
  if (item.tipo === 'projeto') return `${item.titulo} · projeto sem próxima ação`
  if (item.tipo === 'parada') return `"${item.titulo}" · parada há ${item.dias} dia(s), sem prazo`
  return `"${item.titulo}" · em Algum dia há ${item.dias} dia(s)`
}

// O rótulo diz exatamente o que o clique faz — é um atalho que grava na conta
// do Google, então não pode ser vago tipo "Aplicar".
function rotuloDaAcao(s) {
  if (s.acao === 'remarcar') return `Remarcar para ${dataCurta(s.data)}`
  if (s.acao === 'algum_dia') return 'Mover para Algum dia'
  if (s.acao === 'concluir') return 'Marcar como feita'
  if (s.acao === 'reescrever') return `Reescrever: "${s.titulo}"`
  if (s.acao === 'reativar') return s.titulo ? `Reativar como "${s.titulo}"` : 'Reativar em Próximas ações'
  if (s.acao === 'excluir') return 'Excluir de vez'
  return `Criar: ${s.titulo}${s.contexto ? ` @${s.contexto}` : ''}`
}

// A revisão semanal do GTD, sem o ritual: os números que o app calcula
// sozinho e, por cima, uma ação sugerida para cada coisa que pede decisão —
// um clique resolve, "Ignorar" deixa como está. Não é um checklist
// obrigatório, só a tela pronta para destravar a semana.
export default function Revisao({
  numeros,
  comentario,
  sugestoes = [],
  plano = [],
  carregando,
  onGerar,
  onAplicar,
  onAgendarPlano,
}) {
  // Estado de cada sugestão pelo id do item: 'aplicando', 'feito',
  // 'ignorado', ou a mensagem de erro. Recalcular traz uma lista nova, e o
  // estado da anterior não vale mais para ela.
  const [estado, setEstado] = useState({})
  useEffect(() => setEstado({}), [sugestoes])

  // O plano usa o "tarefaId" como chave — não tem o mesmo id de sugestões,
  // mas o mesmo ciclo de vida (aplicando/feito/ignorado/erro).
  const [estadoPlano, setEstadoPlano] = useState({})
  useEffect(() => setEstadoPlano({}), [plano])

  async function aplicar(sugestao) {
    setEstado((e) => ({ ...e, [sugestao.itemId]: 'aplicando' }))
    try {
      await onAplicar(sugestao)
      setEstado((e) => ({ ...e, [sugestao.itemId]: 'feito' }))
    } catch (err) {
      setEstado((e) => ({ ...e, [sugestao.itemId]: `Não deu certo: ${err.message}` }))
    }
  }

  async function agendar(p) {
    setEstadoPlano((e) => ({ ...e, [p.tarefaId]: 'aplicando' }))
    try {
      await onAgendarPlano(p)
      setEstadoPlano((e) => ({ ...e, [p.tarefaId]: 'feito' }))
    } catch (err) {
      setEstadoPlano((e) => ({ ...e, [p.tarefaId]: `Não deu certo: ${err.message}` }))
    }
  }

  const visiveis = sugestoes.filter((s) => estado[s.itemId] !== 'ignorado')
  const planoVisivel = plano.filter((p) => estadoPlano[p.tarefaId] !== 'ignorado')
  const carga = numeros?.carga
  // "Sobrecarregada" aqui é só o oposto de semanaEstaFolgada (revisao.js):
  // as tarefas com prazo já tomam mais de 60% do vão livre da semana.
  const sobrecarregada = carga && carga.minutosLivres > 0 && carga.minutosTarefas > carga.minutosLivres * 0.6

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

          {planoVisivel.length > 0 && (
            <div>
              <div className="revisao-sugestao-item" style={{ marginBottom: 6 }}>Plano da semana</div>
              <div className="revisao-sugestoes">
                {planoVisivel.map((p) => {
                  const st = estadoPlano[p.tarefaId]
                  const minutos = p.candidata.duracao || 30
                  return (
                    <div key={p.tarefaId} className="revisao-sugestao">
                      <div className="revisao-sugestao-item">
                        "{p.candidata.titulo}" · {dataCurta(p.dia)}, {p.hora}–{somarMinutos(p.hora, minutos)}
                      </div>
                      {p.motivo && <div className="muted revisao-sugestao-motivo">{p.motivo}</div>}
                      {st === 'feito' ? (
                        <div className="muted revisao-sugestao-motivo">✓ Agendado.</div>
                      ) : (
                        <div className="revisao-sugestao-acoes">
                          <button type="button" className="primary" disabled={st === 'aplicando'} onClick={() => agendar(p)}>
                            {st === 'aplicando' ? 'Agendando...' : 'Agendar'}
                          </button>
                          <button
                            type="button"
                            disabled={st === 'aplicando'}
                            onClick={() => setEstadoPlano((e) => ({ ...e, [p.tarefaId]: 'ignorado' }))}
                          >
                            Ignorar
                          </button>
                        </div>
                      )}
                      {st && !['aplicando', 'feito'].includes(st) && <div className="form-error">{st}</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {visiveis.length > 0 && (
            <div className="revisao-sugestoes">
              {visiveis.map((s) => {
                const st = estado[s.itemId]
                return (
                  <div key={s.itemId} className="revisao-sugestao">
                    <div className="revisao-sugestao-item">{descreverItem(s.item)}</div>
                    {s.motivo && <div className="muted revisao-sugestao-motivo">{s.motivo}</div>}
                    {st === 'feito' ? (
                      <div className="muted revisao-sugestao-motivo">✓ Feito.</div>
                    ) : (
                      <div className="revisao-sugestao-acoes">
                        <button
                          type="button"
                          className="primary"
                          disabled={st === 'aplicando'}
                          onClick={() => aplicar(s)}
                        >
                          {st === 'aplicando' ? 'Aplicando...' : rotuloDaAcao(s)}
                        </button>
                        <button
                          type="button"
                          disabled={st === 'aplicando'}
                          onClick={() => setEstado((e) => ({ ...e, [s.itemId]: 'ignorado' }))}
                        >
                          Ignorar
                        </button>
                      </div>
                    )}
                    {st && !['aplicando', 'feito'].includes(st) && <div className="form-error">{st}</div>}
                  </div>
                )
              })}
            </div>
          )}

          <ul
            className="revisao-lista"
            style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--body-sm)' }}
          >
            {carga && (
              <li style={sobrecarregada ? { fontWeight: 600, color: 'var(--urgent)' } : undefined}>
                Próximos 7 dias: {formatDuration(carga.minutosTarefas)} de tarefas com prazo,{' '}
                {formatDuration(carga.minutosLivres)} livres na agenda
                {sobrecarregada ? ' — mais tarefa do que espaço.' : '.'}
              </li>
            )}
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
