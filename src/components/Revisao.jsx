import { useEffect, useState } from 'react'
import { formatDuration } from '../lib/dates.js'
import { descreverUltimaRevisao, revisaoAtrasada } from '../lib/revisaoRegistro.js'

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
export function descreverItem(item) {
  if (item.tipo === 'atrasada') return `"${item.titulo}" · atrasada há ${item.dias} dia(s)`
  if (item.tipo === 'aguardando') return `"${item.titulo}" · esperando ${item.quem} há ${item.dias} dias`
  if (item.tipo === 'projeto') return `${item.titulo} · projeto sem próxima ação`
  if (item.tipo === 'parada') return `"${item.titulo}" · parada há ${item.dias} dia(s), sem prazo`
  return `"${item.titulo}" · em Algum dia há ${item.dias} dia(s)`
}

// O rótulo diz exatamente o que o clique faz — é um atalho que grava na conta
// do Google, então não pode ser vago tipo "Aplicar".
export function rotuloDaAcao(s) {
  if (s.acao === 'remarcar') return `Remarcar para ${dataCurta(s.data)}`
  if (s.acao === 'algum_dia') return 'Mover para Algum dia'
  if (s.acao === 'concluir') return 'Marcar como feita'
  if (s.acao === 'reescrever') return `Reescrever: "${s.titulo}"`
  if (s.acao === 'reativar') return s.titulo ? `Reativar como "${s.titulo}"` : 'Reativar em Próximas ações'
  if (s.acao === 'excluir') return 'Excluir de vez'
  return `Criar: ${s.titulo}${s.contexto ? ` @${s.contexto}` : ''}`
}

// Uma ação sugerida por item que pede decisão — um clique resolve,
// "Ignorar" deixa como está. `onDecisao` recebe uma linha legível de cada
// coisa resolvida, para o registro do fechamento da revisão.
export function SugestoesDaRevisao({ sugestoes = [], onAplicar, onDecisao }) {
  const [estado, setEstado] = useState({})
  useEffect(() => setEstado({}), [sugestoes])

  async function aplicar(sugestao) {
    setEstado((e) => ({ ...e, [sugestao.itemId]: 'aplicando' }))
    try {
      await onAplicar(sugestao)
      setEstado((e) => ({ ...e, [sugestao.itemId]: 'feito' }))
      onDecisao?.(`${rotuloDaAcao(sugestao)} — ${descreverItem(sugestao.item)}`)
    } catch (err) {
      setEstado((e) => ({ ...e, [sugestao.itemId]: `Não deu certo: ${err.message}` }))
    }
  }

  const visiveis = sugestoes.filter((s) => estado[s.itemId] !== 'ignorado')
  if (visiveis.length === 0) return null
  return (
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
                <button type="button" className="primary" disabled={st === 'aplicando'} onClick={() => aplicar(s)}>
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
  )
}

// "Sobrecarregada" é só o oposto de semanaEstaFolgada (revisao.js): as
// tarefas com prazo já tomam mais de 60% do vão livre da semana.
export function semanaSobrecarregada(carga) {
  return Boolean(carga && carga.minutosLivres > 0 && carga.minutosTarefas > carga.minutosLivres * 0.6)
}

export function LinhaDeCarga({ carga }) {
  if (!carga) return null
  const sobrecarregada = semanaSobrecarregada(carga)
  return (
    <div className={`revisao-carga${sobrecarregada ? ' is-sobrecarregada' : ''}`}>
      <strong>Próximos 7 dias:</strong> {formatDuration(carga.minutosTarefas)} de tarefas com prazo,{' '}
      {formatDuration(carga.minutosLivres)} livres na agenda
      {sobrecarregada ? ' — mais tarefa do que espaço. Vale adiar ou delegar algo antes de agendar mais.' : '.'}
    </div>
  )
}

// O plano da semana da IA: cada próxima ação forte num vão livre real.
export function PlanoDaSemana({ plano = [], onAgendar, onDecisao }) {
  const [estado, setEstado] = useState({})
  useEffect(() => setEstado({}), [plano])

  async function agendar(p) {
    setEstado((e) => ({ ...e, [p.tarefaId]: 'aplicando' }))
    try {
      await onAgendar(p)
      setEstado((e) => ({ ...e, [p.tarefaId]: 'feito' }))
      onDecisao?.(`Agendado: "${p.candidata.titulo}" em ${dataCurta(p.dia)} às ${p.hora}`)
    } catch (err) {
      setEstado((e) => ({ ...e, [p.tarefaId]: `Não deu certo: ${err.message}` }))
    }
  }

  const visivel = plano.filter((p) => estado[p.tarefaId] !== 'ignorado')
  if (visivel.length === 0) return null
  return (
    <div className="revisao-sugestoes">
      {visivel.map((p) => {
        const st = estado[p.tarefaId]
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
                <button type="button" disabled={st === 'aplicando'} onClick={() => setEstado((e) => ({ ...e, [p.tarefaId]: 'ignorado' }))}>
                  Ignorar
                </button>
              </div>
            )}
            {st && !['aplicando', 'feito'].includes(st) && <div className="form-error">{st}</div>}
          </div>
        )
      })}
    </div>
  )
}

// Os números que o app calcula sozinho, sem IA.
export function NumerosDaRevisao({ numeros }) {
  if (!numeros) return null
  return (
    <ul className="revisao-lista">
      <li>
        {numeros.entradaVazia
          ? 'Entrada vazia — nada esperando ser esclarecido.'
          : 'Ainda há algo na Entrada esperando ser esclarecido.'}
      </li>
      <li>{numeros.atrasadas === 0 ? 'Nenhuma tarefa atrasada.' : `${numeros.atrasadas} tarefa(s) atrasada(s).`}</li>
      <li>{numeros.paradas === 0 ? 'Nada parado há mais de 3 dias.' : `${numeros.paradas} tarefa(s) parada(s) há mais de 3 dias.`}</li>
      <li>
        {numeros.projetosParados.length === 0
          ? 'Todo projeto tem alguma próxima ação.'
          : `Projeto(s) sem próxima ação: ${numeros.projetosParados.map((p) => `#${p}`).join(', ')}.`}
      </li>
      <li>
        {numeros.aguardandoEnvelhecendo.length === 0
          ? 'Nenhuma espera com mais de uma semana.'
          : `Esperando há mais de uma semana: ${numeros.aguardandoEnvelhecendo.map((a) => `"${a.title}" (${a.dias}d)`).join(', ')}.`}
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
  )
}

// A aba Revisão do painel é só a porta de entrada: quando foi a última, o
// essencial dos números se já calculados, e o botão que abre a revisão
// guiada em tela própria (RevisaoGuiada.jsx). Antes a revisão inteira —
// sugestões da IA, plano da semana, números — se espremia aqui, numa coluna
// de 400px, justo a parte do app que mais pede espaço.
export default function Revisao({ numeros, ultimaRevisao, onAbrir }) {
  const atrasada = revisaoAtrasada(ultimaRevisao)
  return (
    <div className="revisao-entrada">
      <p className={`revisao-ultima${atrasada ? ' is-atrasada' : ''}`}>{descreverUltimaRevisao(ultimaRevisao)}</p>
      <p className="muted" style={{ margin: 0 }}>
        Um passo de cada vez: esvaziar a Entrada, decidir o que está atrasado e parado, cobrar quem você espera,
        olhar cada projeto, reavaliar o Algum dia e planejar a semana.
      </p>
      {numeros && (
        <div className="revisao-resumo">
          <span><strong>{numeros.atrasadas}</strong> atrasada(s)</span>
          <span><strong>{numeros.projetosParados.length}</strong> projeto(s) parado(s)</span>
          <span><strong>{numeros.concluidasNaSemana}</strong> concluída(s) na semana</span>
        </div>
      )}
      <button type="button" className="primary" onClick={onAbrir}>
        {numeros ? 'Continuar a revisão' : 'Começar a revisão'}
      </button>
    </div>
  )
}
