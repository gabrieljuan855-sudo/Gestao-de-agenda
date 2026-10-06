import { useState } from 'react'
import { PRIORITY_LABEL } from '../lib/priority.js'
import { fromInputs } from '../lib/dates.js'
import { PROJETOS_IA_LIGADA } from '../lib/aiCooldown.js'
import { montarContextoDoProjeto, descreverEnvio, pedirAoProjeto } from '../lib/aiProjeto.js'
import { pareceIdeia } from '../lib/projetos.js'

function dataCurta(iso) {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

// O assistente do projeto: a IA trabalhando dentro do caso, sempre por um
// botão e sempre devolvendo uma proposta — nada vira tarefa ou ficha sem a
// pessoa escolher. É o que destrava o projeto parado ("sem próxima ação"), o
// sem chegada ("sem resultado") e a ideia escrita no lugar da ação.
export default function AssistenteDoProjeto({ projeto, grupos, anotacoes, contextos, idProximas, onCreateTask, onSalvar, onAtualizarTarefa }) {
  const [modo, setModo] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)
  const [resposta, setResposta] = useState(null)
  const [escolhidas, setEscolhidas] = useState({})
  const [textoResultado, setTextoResultado] = useState('')
  const [acaoDividida, setAcaoDividida] = useState('')
  const [feito, setFeito] = useState(null)

  if (!PROJETOS_IA_LIGADA) return null
  if (projeto.semIA) {
    return <p className="muted assistente-desligado">IA desligada neste projeto (ver a ficha).</p>
  }

  const alvo = pareceIdeia(projeto.proximaAcao?.title) ? projeto.proximaAcao : null
  const contexto = montarContextoDoProjeto({ projeto, grupos, anotacoes, contextos })
  const rotina = projeto.tipo === 'rotina'

  async function pedir(qual) {
    setModo(qual)
    setCarregando(true)
    setErro(null)
    setResposta(null)
    setFeito(null)
    try {
      const ctx = qual === 'dividir' ? montarContextoDoProjeto({ projeto, grupos, anotacoes, contextos, alvo }) : contexto
      const r = await pedirAoProjeto(qual, ctx)
      setResposta(r)
      if (qual === 'planejar') setEscolhidas(Object.fromEntries((r.acoes || []).map((_, i) => [i, true])))
      if (qual === 'resultado') setTextoResultado(r.resultado || '')
      if (qual === 'dividir') {
        setAcaoDividida(r.acao || '')
        setEscolhidas(Object.fromEntries((r.mais || []).map((_, i) => [i, true])))
      }
    } catch (err) {
      setErro(
        err.transiente
          ? 'A IA está sobrecarregada ou sem cota agora — tente de novo daqui a pouco.'
          : `Não deu para falar com a IA: ${err.message}`
      )
    } finally {
      setCarregando(false)
    }
  }

  function criarTarefa({ titulo, contexto: ctx, prioridade, prazo }) {
    return onCreateTask({
      title: titulo,
      priority: prioridade || 'media',
      due: prazo ? fromInputs(prazo) : null,
      contexto: ctx || null,
      projeto: projeto.id,
      tasklistId: idProximas || '@default',
    })
  }

  async function criarPlano() {
    const acoes = (resposta?.acoes || []).filter((_, i) => escolhidas[i])
    setCarregando(true)
    try {
      for (const a of acoes) await criarTarefa(a)
      setFeito(`✓ ${acoes.length} ${acoes.length === 1 ? 'ação criada' : 'ações criadas'} em Próximas ações.`)
      setResposta(null)
    } catch (err) {
      setErro(`Algumas ações não foram criadas: ${err.message}`)
    } finally {
      setCarregando(false)
    }
  }

  function usarResultado() {
    onSalvar({ id: projeto.id, resultado: textoResultado.trim() })
    setFeito(rotina ? '✓ Propósito salvo na ficha.' : '✓ Resultado salvo na ficha.')
    setResposta(null)
  }

  async function aplicarDivisao() {
    setCarregando(true)
    try {
      const notasAntes = alvo.notesClean ? `${alvo.notesClean}\n\n` : ''
      await onAtualizarTarefa(alvo, {
        title: acaoDividida.trim(),
        notes: `${notasAntes}${resposta.detalhes || alvo.title}`,
      })
      const mais = (resposta.mais || []).filter((_, i) => escolhidas[i])
      for (const titulo of mais) await criarTarefa({ titulo })
      setFeito(`✓ Ação reescrita${mais.length ? ` e ${mais.length} passo(s) seguinte(s) criados` : ''}. O texto original foi para as notas da tarefa.`)
      setResposta(null)
    } catch (err) {
      setErro(`Não deu para aplicar: ${err.message}`)
    } finally {
      setCarregando(false)
    }
  }

  const alternar = (i) => setEscolhidas((e) => ({ ...e, [i]: !e[i] }))

  return (
    <section className="assistente">
      <div className="assistente-cabeca">
        <h3 className="projetos-secao">Assistente do projeto</h3>
        <span className="muted t-label-sm">{descreverEnvio(contexto)}</span>
      </div>
      <div className="assistente-botoes">
        <button type="button" onClick={() => pedir('planejar')} disabled={carregando}>
          {rotina ? 'Sugerir itens de pauta' : 'Planejar próximos passos'}
        </button>
        <button type="button" onClick={() => pedir('resultado')} disabled={carregando}>
          {rotina ? 'Definir propósito' : projeto.resultado ? 'Refinar o resultado' : 'Definir o resultado'}
        </button>
        {alvo && (
          <button type="button" onClick={() => pedir('dividir')} disabled={carregando}>
            Transformar a ideia em ações
          </button>
        )}
      </div>

      {carregando && <p className="muted" style={{ margin: 0 }}>Pensando...</p>}
      {erro && <div className="form-error">{erro}</div>}
      {feito && <p className="revisao-ok">{feito}</p>}

      {resposta && modo === 'planejar' && (
        <div className="assistente-proposta">
          {(resposta.acoes || []).length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>A IA não encontrou passos novos além dos que já existem.</p>
          ) : (
            <>
              {resposta.acoes.map((a, i) => (
                <label key={i} className={`assistente-acao${escolhidas[i] ? '' : ' is-desmarcada'}`}>
                  <input type="checkbox" checked={Boolean(escolhidas[i])} onChange={() => alternar(i)} />
                  <span className="assistente-acao-texto">
                    <strong>{a.titulo}</strong>
                    <span className="muted t-label-sm">
                      <span className={`pill ${a.prioridade}`}>{PRIORITY_LABEL[a.prioridade]}</span>
                      {a.contexto && ` @${a.contexto}`}
                      {a.prazo && ` · prazo ${dataCurta(a.prazo)}`}
                      {a.motivo && ` · ${a.motivo}`}
                    </span>
                  </span>
                </label>
              ))}
              <div className="assistente-acoes-finais">
                <button type="button" className="primary" onClick={criarPlano} disabled={carregando || !Object.values(escolhidas).some(Boolean)}>
                  Criar {Object.values(escolhidas).filter(Boolean).length} em Próximas ações
                </button>
                <button type="button" onClick={() => setResposta(null)}>Descartar</button>
              </div>
            </>
          )}
        </div>
      )}

      {resposta && modo === 'resultado' && (
        <div className="assistente-proposta">
          <label className="field">
            <span>{rotina ? 'Para que serve' : 'Como sei que terminou'}</span>
            <textarea rows={2} value={textoResultado} onChange={(e) => setTextoResultado(e.target.value)} />
          </label>
          <div className="assistente-acoes-finais">
            <button type="button" className="primary" onClick={usarResultado} disabled={!textoResultado.trim()}>
              Usar na ficha
            </button>
            <button type="button" onClick={() => setResposta(null)}>Descartar</button>
          </div>
        </div>
      )}

      {resposta && modo === 'dividir' && (
        <div className="assistente-proposta">
          <label className="field">
            <span>Primeiro passo (substitui o título da tarefa)</span>
            <input type="text" value={acaoDividida} onChange={(e) => setAcaoDividida(e.target.value)} />
          </label>
          {resposta.detalhes && (
            <details>
              <summary className="muted t-label">O restante do texto vai para as notas da tarefa</summary>
              <p className="assistente-detalhes">{resposta.detalhes}</p>
            </details>
          )}
          {(resposta.mais || []).length > 0 && (
            <>
              <div className="entrada-secao">Passos seguintes (viram tarefas)</div>
              {resposta.mais.map((m, i) => (
                <label key={i} className={`assistente-acao${escolhidas[i] ? '' : ' is-desmarcada'}`}>
                  <input type="checkbox" checked={Boolean(escolhidas[i])} onChange={() => alternar(i)} />
                  <span className="assistente-acao-texto"><strong>{m}</strong></span>
                </label>
              ))}
            </>
          )}
          <div className="assistente-acoes-finais">
            <button type="button" className="primary" onClick={aplicarDivisao} disabled={carregando || !acaoDividida.trim()}>
              Aplicar
            </button>
            <button type="button" onClick={() => setResposta(null)}>Descartar</button>
          </div>
        </div>
      )}
    </section>
  )
}
