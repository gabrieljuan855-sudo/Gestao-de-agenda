import { useEffect, useRef, useState } from 'react'
import TelaSobreposta from './TelaSobreposta.jsx'
import { SugestoesDaRevisao, PlanoDaSemana, NumerosDaRevisao, LinhaDeCarga } from './Revisao.jsx'
import { PRIORITY_LABEL } from '../lib/priority.js'
import { dateOnlyFromISO } from '../lib/dates.js'

// A revisão semanal do GTD como um percurso, e não um relatório solto: uma
// etapa de cada vez, na ordem do método, com tudo o que cada uma pede
// resolvível ali mesmo. Antes era uma rolagem longa espremida numa coluna
// lateral — os números, as sugestões e o plano misturados — sem dizer por
// onde começar nem quando tinha acabado.
export const ETAPAS = [
  { id: 'entrada', titulo: 'Esvaziar a Entrada', pergunta: 'O que chegou e ainda não foi decidido?' },
  { id: 'acoes', titulo: 'Atrasadas e paradas', pergunta: 'O que venceu ou está parado sem ninguém mexer?' },
  { id: 'aguardando', titulo: 'Aguardando', pergunta: 'Quem você precisa cobrar?' },
  { id: 'projetos', titulo: 'Projetos', pergunta: 'Cada projeto tem um próximo passo — e ainda faz sentido?' },
  { id: 'algumdia', titulo: 'Algum dia', pergunta: 'Algo daqui virou prioridade, ou pode ir embora de vez?' },
  { id: 'plano', titulo: 'Plano da semana', pergunta: 'Quando cada coisa importante vai ser feita?' },
  { id: 'fechar', titulo: 'Fechamento', pergunta: 'O que a semana teve, e o que ficou decidido.' },
]

const TIPOS_DA_ETAPA = {
  acoes: ['atrasada', 'parada'],
  aguardando: ['aguardando'],
  projetos: ['projeto'],
  algumdia: ['algum_dia'],
}

function prazoCurto(due) {
  return dateOnlyFromISO(due).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function Pendencia({ texto }) {
  return <span className="revisao-etapa-contagem">{texto}</span>
}

export default function RevisaoGuiada({
  revisao,
  etapa,
  onEtapa,
  decisoes,
  onDecisao,
  contagens,
  elementoEntrada,
  elementoAguardando,
  elementoAlgumDia,
  tarefasAtrasadas,
  onEditarTarefa,
  onConcluirTarefa,
  projetos,
  onAbrirProjeto,
  onSituacaoProjeto,
  onAplicar,
  onAgendarPlano,
  onConcluir,
  onFechar,
}) {
  const indice = Math.max(0, ETAPAS.findIndex((e) => e.id === etapa))
  const atual = ETAPAS[indice]
  const [revisados, setRevisados] = useState({})
  const navRef = useRef(null)

  // No celular as etapas são uma faixa que rola de lado: a etapa atual
  // precisa estar à vista, não cortada na borda.
  useEffect(() => {
    navRef.current?.querySelector('.is-atual')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [etapa])
  const [concluindo, setConcluindo] = useState(false)

  // Abrir a revisão é o pedido: os números (e, com a IA ligada, as sugestões)
  // começam a ser calculados na hora, enquanto a pessoa esvazia a Entrada.
  useEffect(() => {
    if (!revisao.numeros && !revisao.carregando) revisao.gerar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sugestoesDa = (id) => revisao.sugestoes.filter((s) => (TIPOS_DA_ETAPA[id] || []).includes(s.item.tipo))

  async function concluir() {
    setConcluindo(true)
    try {
      await onConcluir()
    } finally {
      setConcluindo(false)
    }
  }

  async function mudarSituacao(projeto, situacao) {
    await onSituacaoProjeto(projeto.id, situacao)
    onDecisao(`Projeto "${projeto.nome}" ${situacao === 'pausado' ? 'pausado' : 'concluído'}`)
  }

  return (
    <TelaSobreposta
      titulo="Revisão da semana"
      onFechar={onFechar}
      acoes={
        <button type="button" onClick={revisao.gerar} disabled={revisao.carregando} title="Buscar tudo de novo">
          {revisao.carregando ? 'Calculando...' : 'Recalcular'}
        </button>
      }
    >
      <div className="revisao-guiada">
        <nav className="revisao-etapas" aria-label="Etapas da revisão" ref={navRef}>
          {ETAPAS.map((e, i) => (
            <button
              key={e.id}
              type="button"
              className={`revisao-etapa${e.id === atual.id ? ' is-atual' : ''}${i < indice ? ' is-passada' : ''}`}
              aria-current={e.id === atual.id ? 'step' : undefined}
              onClick={() => onEtapa(e.id)}
            >
              <span className="revisao-etapa-numero">{i < indice ? '✓' : i + 1}</span>
              <span className="revisao-etapa-titulo">{e.titulo}</span>
              {contagens[e.id] > 0 && <Pendencia texto={contagens[e.id]} />}
            </button>
          ))}
        </nav>

        <section className="revisao-conteudo">
          <header className="revisao-conteudo-cabeca">
            <span className="muted t-label">Etapa {indice + 1} de {ETAPAS.length}</span>
            <h2 className="t-headline">{atual.titulo}</h2>
            <p className="muted" style={{ margin: 0 }}>{atual.pergunta}</p>
          </header>

          {revisao.carregando && !revisao.numeros && <p className="muted">Calculando a semana...</p>}

          {atual.id === 'entrada' && (contagens.entrada > 0 ? elementoEntrada : <p className="revisao-ok">✓ Entrada vazia. Nada esperando decisão.</p>)}

          {atual.id === 'acoes' && (
            <>
              <SugestoesDaRevisao sugestoes={sugestoesDa('acoes')} onAplicar={onAplicar} onDecisao={onDecisao} />
              {tarefasAtrasadas.length === 0 ? (
                <p className="revisao-ok">✓ Nenhuma tarefa atrasada.</p>
              ) : (
                <div className="aguardando-lista">
                  <div className="entrada-secao">Atrasadas ({tarefasAtrasadas.length})</div>
                  {tarefasAtrasadas.map((t) => (
                    <div key={t.id} className="aguardando-item">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{t.title}</div>
                        <div className="muted t-label-sm">
                          <span className={`pill ${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>{' '}
                          <span style={{ color: 'var(--urgent)' }}>venceu {prazoCurto(t.due)}</span>
                          {t.projeto && ` · #${t.projeto}`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button type="button" onClick={() => onEditarTarefa(t)}>Remarcar/editar</button>
                        <button
                          type="button"
                          onClick={async () => {
                            await onConcluirTarefa(t)
                            onDecisao(`Concluída: "${t.title}"`)
                          }}
                        >
                          Feita
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {atual.id === 'aguardando' && (
            <>
              <SugestoesDaRevisao sugestoes={sugestoesDa('aguardando')} onAplicar={onAplicar} onDecisao={onDecisao} />
              {elementoAguardando}
            </>
          )}

          {atual.id === 'projetos' && (
            <>
              <SugestoesDaRevisao sugestoes={sugestoesDa('projetos')} onAplicar={onAplicar} onDecisao={onDecisao} />
              {projetos.length === 0 ? (
                <p className="revisao-ok">Nenhum projeto ativo.</p>
              ) : (
                <div className="aguardando-lista">
                  <div className="entrada-secao">
                    {Object.values(revisados).filter(Boolean).length} de {projetos.length} revisados
                  </div>
                  {projetos.map((p) => (
                    <div key={p.id} className={`aguardando-item revisao-projeto${revisados[p.id] ? ' is-revisado' : ''}`}>
                      <label className="revisao-projeto-check" title="Marcar como revisado">
                        <input
                          type="checkbox"
                          checked={Boolean(revisados[p.id])}
                          onChange={(e) => setRevisados((r) => ({ ...r, [p.id]: e.target.checked }))}
                        />
                      </label>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>
                          {p.nome}
                          {p.tipo === 'rotina' && <span className="muted t-label-sm"> · rotina</span>}
                        </div>
                        <div className="muted t-label-sm revisao-projeto-acao">
                          {p.semProximaAcao ? (
                            <span className="pill projeto-pill-parado">sem próxima ação</span>
                          ) : p.proximaAcao ? (
                            `→ ${p.proximaAcao.title}`
                          ) : (
                            'sem itens pendentes'
                          )}
                          {p.atrasadas > 0 && <span style={{ color: 'var(--urgent)' }}> · {p.atrasadas} atrasada(s)</span>}
                          {p.diasSemAtividade >= 14 && ` · sem mexer há ${p.diasSemAtividade} dias`}
                        </div>
                      </div>
                      <div className="revisao-projeto-botoes">
                        <button type="button" onClick={() => onAbrirProjeto(p.id)}>Abrir</button>
                        {!p.implicito && (
                          <>
                            <button type="button" onClick={() => mudarSituacao(p, 'pausado')}>Pausar</button>
                            <button type="button" onClick={() => mudarSituacao(p, 'concluido')}>Concluir</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {atual.id === 'algumdia' && (
            <>
              <SugestoesDaRevisao sugestoes={sugestoesDa('algumdia')} onAplicar={onAplicar} onDecisao={onDecisao} />
              {elementoAlgumDia}
            </>
          )}

          {atual.id === 'plano' && (
            <>
              <LinhaDeCarga carga={revisao.numeros?.carga} />
              {revisao.plano.length > 0 ? (
                <PlanoDaSemana plano={revisao.plano} onAgendar={onAgendarPlano} onDecisao={onDecisao} />
              ) : (
                <p className="muted">
                  {revisao.carregando ? 'Montando o plano...' : 'Sem sugestão de plano agora — as próximas ações já estão na tela Próximas.'}
                </p>
              )}
            </>
          )}

          {atual.id === 'fechar' && (
            <>
              {revisao.comentario && <p className="revisao-comentario">{revisao.comentario}</p>}
              <NumerosDaRevisao numeros={revisao.numeros} />
              <div>
                <div className="entrada-secao">Decidido nesta revisão ({decisoes.length})</div>
                {decisoes.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>Nada registrado ainda.</p>
                ) : (
                  <ul className="revisao-lista">
                    {decisoes.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                )}
              </div>
              <p className="muted" style={{ margin: 0 }}>
                Concluir guarda um resumo como anotação ("Revisão de hoje") e marca a data da revisão.
              </p>
              <div>
                <button type="button" className="primary" onClick={concluir} disabled={concluindo}>
                  {concluindo ? 'Concluindo...' : 'Concluir revisão'}
                </button>
              </div>
            </>
          )}

          <footer className="revisao-navegacao">
            <button type="button" onClick={() => onEtapa(ETAPAS[indice - 1].id)} disabled={indice === 0}>
              ← Anterior
            </button>
            {indice < ETAPAS.length - 1 && (
              <button type="button" className="primary" onClick={() => onEtapa(ETAPAS[indice + 1].id)}>
                Próxima: {ETAPAS[indice + 1].titulo} →
              </button>
            )}
          </footer>
        </section>
      </div>
    </TelaSobreposta>
  )
}
