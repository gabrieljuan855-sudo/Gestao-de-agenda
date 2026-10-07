import { useState } from 'react'
import { PRIORITY_LABEL } from '../lib/priority.js'
import { fromInputs } from '../lib/dates.js'
import { PROJETOS_IA_LIGADA } from '../lib/aiCooldown.js'
import { montarContextoDoProjeto, descreverEnvio, pedirAoProjeto } from '../lib/aiProjeto.js'
import { pareceIdeia } from '../lib/projetos.js'

// Os documentos que o assistente redige. O pedido em si fica no Worker
// (DOCUMENTOS_DO_PROJETO); daqui só sai o tipo.
const DOCUMENTOS = [
  { tipo: 'pauta', rotulo: 'Pauta da reunião' },
  { tipo: 'ata', rotulo: 'Ata da reunião' },
  { tipo: 'relatorio', rotulo: 'Relatório de andamento' },
  { tipo: 'plano', rotulo: 'Plano de ação' },
  { tipo: 'oficio', rotulo: 'Ofício' },
  { tipo: 'email', rotulo: 'E-mail de cobrança' },
]

function dataCurta(iso) {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

// O assistente do projeto: a IA trabalhando dentro do caso, sempre por um
// botão e sempre devolvendo uma proposta — nada vira tarefa ou ficha sem a
// pessoa escolher. É o que destrava o projeto parado ("sem próxima ação"), o
// sem chegada ("sem resultado") e a ideia escrita no lugar da ação.
export default function AssistenteDoProjeto({
  projeto,
  grupos,
  anotacoes,
  contextos,
  idProximas,
  onCreateTask,
  onSalvar,
  onAtualizarTarefa,
  onSalvarAnotacao,
  onAbrirNota,
}) {
  const [modo, setModo] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)
  const [resposta, setResposta] = useState(null)
  const [escolhidas, setEscolhidas] = useState({})
  const [textoResultado, setTextoResultado] = useState('')
  const [acaoDividida, setAcaoDividida] = useState('')
  const [feito, setFeito] = useState(null)
  const [tipoDoc, setTipoDoc] = useState(projeto.tipo === 'rotina' ? 'pauta' : 'relatorio')
  const [instrucao, setInstrucao] = useState('')
  const [doc, setDoc] = useState({ titulo: '', texto: '' })
  const [notaSalva, setNotaSalva] = useState(null)
  const [pergunta, setPergunta] = useState('')

  if (!PROJETOS_IA_LIGADA) return null
  // Projeto marcado "Não usar IA" (em Configurar) simplesmente não mostra o
  // assistente: um aviso ali seria só mais uma linha para ler.
  if (projeto.semIA) return null

  const alvo = pareceIdeia(projeto.proximaAcao?.title) ? projeto.proximaAcao : null
  const contexto = montarContextoDoProjeto({ projeto, grupos, anotacoes, contextos })
  const rotina = projeto.tipo === 'rotina'

  // Documento e pergunta primeiro abrem um formulário; o pedido sai no envio.
  function abrir(qual) {
    setModo(qual)
    setResposta(null)
    setErro(null)
    setFeito(null)
    setNotaSalva(null)
  }

  async function pedir(qual) {
    setModo(qual)
    setCarregando(true)
    setErro(null)
    setResposta(null)
    setFeito(null)
    setNotaSalva(null)
    try {
      const ctx = qual === 'dividir' ? montarContextoDoProjeto({ projeto, grupos, anotacoes, contextos, alvo }) : contexto
      const extra =
        qual === 'documento' ? { documento: { tipo: tipoDoc, instrucao: instrucao.trim() } } : qual === 'perguntar' ? { pergunta: pergunta.trim() } : {}
      const r = await pedirAoProjeto(qual, ctx, extra)
      setResposta(r)
      if (qual === 'documento') setDoc({ titulo: r.titulo || DOCUMENTOS.find((d) => d.tipo === tipoDoc).rotulo, texto: r.texto || '' })
      if (qual === 'planejar') setEscolhidas(Object.fromEntries((r.acoes || []).map((_, i) => [i, true])))
      if (qual === 'resultado') setTextoResultado(r.resultado || '')
      if (qual === 'dividir') {
        setAcaoDividida(r.acao || '')
        setEscolhidas(Object.fromEntries((r.mais || []).map((_, i) => [i, true])))
      }
    } catch (err) {
      setErro(
        err.transiente
          ? err.message
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

  // O documento vira anotação do projeto: sincroniza pelo Drive como as
  // outras e aparece na coluna Anotações, pronto para editar.
  function salvarDocumento() {
    const nota = onSalvarAnotacao(projeto.id, { title: doc.titulo.trim(), body: doc.texto })
    setNotaSalva(nota)
    setResposta(null)
  }

  async function copiarDocumento() {
    try {
      await navigator.clipboard.writeText(`${doc.titulo}\n\n${doc.texto}`)
      setFeito('✓ Copiado.')
    } catch {
      setErro('O navegador não deixou copiar. Selecione o texto e copie à mão.')
    }
  }

  const alternar = (i) => setEscolhidas((e) => ({ ...e, [i]: !e[i] }))

  return (
    // Assist chips do MD3: ações sugeridas, discretas, numa linha só. Antes
    // era uma caixa tracejada com título e explicação no topo da página —
    // ocupava o lugar do que a pessoa abre o projeto para ver.
    <section className="assistente" title={descreverEnvio(contexto)}>
      <div className="assistente-botoes" role="group" aria-label="Pedir à IA">
        <button type="button" className="chip-ia" onClick={() => pedir('planejar')} disabled={carregando}>
          {rotina ? 'Sugerir pauta' : 'Planejar passos'}
        </button>
        {alvo && (
          <button type="button" className="chip-ia" onClick={() => pedir('dividir')} disabled={carregando}>
            Dividir a ideia
          </button>
        )}
        <button type="button" className={`chip-ia${modo === 'documento' ? ' is-ativo' : ''}`} onClick={() => abrir('documento')} disabled={carregando}>
          Redigir documento
        </button>
        <button type="button" className={`chip-ia${modo === 'perguntar' ? ' is-ativo' : ''}`} onClick={() => abrir('perguntar')} disabled={carregando}>
          Perguntar
        </button>
        {!projeto.resultado && (
          <button type="button" className="chip-ia" onClick={() => pedir('resultado')} disabled={carregando}>
            {rotina ? 'Definir propósito' : 'Definir resultado'}
          </button>
        )}
      </div>

      {modo === 'documento' && !resposta && (
        <form
          className="assistente-proposta"
          onSubmit={(e) => {
            e.preventDefault()
            pedir('documento')
          }}
        >
          <label className="field">
            <span>Documento</span>
            <select value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)}>
              {DOCUMENTOS.map((d) => <option key={d.tipo} value={d.tipo}>{d.rotulo}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{tipoDoc === 'ata' ? 'O que aconteceu na reunião (anotações soltas servem)' : 'Orientações (opcional): destinatário, tom, o que não pode faltar'}</span>
            <textarea rows={3} value={instrucao} onChange={(e) => setInstrucao(e.target.value)} maxLength={3000} />
          </label>
          <div className="assistente-acoes-finais">
            <button type="submit" className="primary" disabled={carregando}>Gerar</button>
          </div>
        </form>
      )}

      {modo === 'perguntar' && (
        <form
          className="assistente-pergunta"
          onSubmit={(e) => {
            e.preventDefault()
            if (pergunta.trim()) pedir('perguntar')
          }}
        >
          <input
            type="text"
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            maxLength={300}
            placeholder="Ex.: o que ficou combinado com o perito?"
            aria-label="Pergunta sobre o projeto"
          />
          <button type="submit" disabled={carregando || !pergunta.trim()}>Perguntar</button>
        </form>
      )}

      {notaSalva && (
        <p className="revisao-ok">
          ✓ Salvo nas anotações do projeto.{' '}
          <button type="button" className="link-btn" onClick={() => onAbrirNota(notaSalva.id)}>Abrir</button>
        </p>
      )}

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

      {resposta && modo === 'documento' && (
        <div className="assistente-proposta">
          <label className="field">
            <span>Título</span>
            <input type="text" value={doc.titulo} onChange={(e) => setDoc((d) => ({ ...d, titulo: e.target.value }))} />
          </label>
          <label className="field">
            <span>Texto (revise antes de usar: onde faltou dado, há um [marcador])</span>
            <textarea className="assistente-documento" rows={14} value={doc.texto} onChange={(e) => setDoc((d) => ({ ...d, texto: e.target.value }))} />
          </label>
          <div className="assistente-acoes-finais">
            <button type="button" className="primary" onClick={salvarDocumento} disabled={!doc.texto.trim()}>
              Salvar como anotação
            </button>
            <button type="button" onClick={copiarDocumento}>Copiar</button>
            <button type="button" onClick={() => setResposta(null)}>Descartar</button>
          </div>
        </div>
      )}

      {resposta && modo === 'perguntar' && (
        <div className="assistente-resposta">
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{resposta.resposta || 'A IA não encontrou resposta no projeto.'}</p>
          {resposta.fontes?.length > 0 && (
            <span className="muted t-label-sm">Com base em: {resposta.fontes.join(' · ')}</span>
          )}
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
