import { useEffect, useRef, useState } from 'react'
import Banner from './Banner.jsx'
import Modal from './Modal.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import AssistenteDoProjeto from './AssistenteDoProjeto.jsx'
import { PRIORITY_LABEL } from '../lib/priority.js'
import { isOverdueTask } from '../lib/tasks.js'
import { dateOnlyFromISO, addDays, toDateInput } from '../lib/dates.js'
import { eventStart, isAllDay } from '../lib/events.js'
import { parseQuickAdd, descreverQuando } from '../lib/nlp.js'
import { construirRecorrencia } from '../lib/recorrencia.js'
import { pastaDoProjeto } from '../lib/googleApi.js'
import Anexos from './Anexos.jsx'
import { textoSemFormato } from '../lib/notasFormatacao.js'
import {
  SITUACOES,
  TIPOS,
  PROJETO_PROP,
  panoramaDosProjetos,
  pareceIdeia,
  novoProjeto,
  tarefasDoProjeto,
  eventoDoProjeto,
  adicionarMarco,
  alternarMarco,
  removerMarco,
  proximoMarco,
  linhaDoTempoDoProjeto,
  juntarConcluidas,
  trechoDaAnotacao,
} from '../lib/projetos.js'

function dataCurta(valor) {
  return dateOnlyFromISO(valor).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function quandoDoEvento(event) {
  const inicio = eventStart(event)
  const dia = inicio.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
  if (isAllDay(event)) return dia
  return `${dia} · ${inicio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

// ---------- Lista ----------

function LinhaDoProjeto({ projeto, onAbrir, selecionado }) {
  const partes = []
  if (projeto.pendentes) partes.push(`${projeto.pendentes} ${projeto.pendentes === 1 ? 'tarefa' : 'tarefas'}`)
  if (projeto.anotacoes) partes.push(`${projeto.anotacoes} ${projeto.anotacoes === 1 ? 'anotação' : 'anotações'}`)
  const nArquivos = projeto.arquivos?.length || 0
  if (nArquivos) partes.push(`${nArquivos} ${nArquivos === 1 ? 'arquivo' : 'arquivos'}`)
  if (projeto.prazo) partes.push(`prazo ${dataCurta(projeto.prazo)}`)
  const marco = proximoMarco(projeto.marcos, hojeIso())
  return (
    <button
      type="button"
      className={`projeto-linha${selecionado ? ' is-selecionado' : ''}`}
      aria-current={selecionado ? 'true' : undefined}
      onClick={() => onAbrir(projeto.id)}
    >
      <span className="projeto-linha-topo">
        <span className="projeto-linha-nome">{projeto.nome}</span>
        {projeto.semProximaAcao && <span className="pill projeto-pill-parado">sem próxima ação</span>}
        {projeto.concluidoComPendencias && <span className="pill projeto-pill-parado">concluído com pendências</span>}
        {projeto.implicito && <span className="pill projeto-pill-situacao">sem ficha</span>}
        {projeto.atrasadas > 0 && (
          <span className="pill projeto-pill-atraso">
            {projeto.atrasadas} {projeto.atrasadas === 1 ? 'atrasada' : 'atrasadas'}
          </span>
        )}
      </span>
      {projeto.proximaAcao && <span className="projeto-linha-acao">→ {projeto.proximaAcao.title}</span>}
      {marco && (
        <span className={`t-label projeto-linha-marco${marco.atrasado ? ' is-atrasado' : ''}`}>
          ◆ {marco.titulo}{marco.data && ` · ${dataCurta(marco.data)}`}
        </span>
      )}
      {partes.length > 0 && <span className="muted t-label">{partes.join(' · ')}</span>}
    </button>
  )
}

function ListaDeProjetos({ lista, onAbrir, onCriar, abertoId }) {
  const [nome, setNome] = useState('')
  const porSituacao = (s) => lista.filter((p) => p.situacao === s)
  const concluidos = porSituacao('concluido')
  // Rotina ativa tem seção própria: misturada aos projetos, ela parecia um
  // projeto que nunca anda.
  const secoes = [
    { id: 'ativos', titulo: 'Projetos ativos', itens: lista.filter((p) => p.situacao === 'ativo' && p.tipo !== 'rotina') },
    { id: 'rotinas', titulo: 'Rotinas', itens: lista.filter((p) => p.situacao === 'ativo' && p.tipo === 'rotina') },
    { id: 'pausados', titulo: 'Pausados', itens: porSituacao('pausado') },
  ]

  function criar(e) {
    e.preventDefault()
    if (!nome.trim()) return
    const id = onCriar(nome)
    if (id) {
      setNome('')
      onAbrir(id)
    }
  }

  return (
    <div className="projetos">
      <form className="projetos-novo" onSubmit={criar}>
        <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Novo projeto (ex.: Caso Maria, Mudança de escritório)" />
        <button type="submit" className="primary" disabled={!nome.trim()}>Criar</button>
      </form>

      {lista.length === 0 && (
        <p className="muted">
          Nenhum projeto ainda. Um projeto é qualquer resultado que pede mais de uma ação — crie um aqui, ou marque
          #projeto numa tarefa e ele aparece sozinho.
        </p>
      )}

      {secoes.map((secao) =>
        secao.itens.length > 0 ? (
          <section key={secao.id}>
            <h3 className="projetos-secao">{secao.titulo}</h3>
            <div className="projetos-lista">
              {secao.itens.map((p) => (
                <LinhaDoProjeto key={p.id} projeto={p} onAbrir={onAbrir} selecionado={p.id === abertoId} />
              ))}
            </div>
          </section>
        ) : null
      )}

      {/* Concluído não some — é o histórico dos casos —, mas também não
          disputa atenção com o que ainda está andando. */}
      {concluidos.length > 0 && (
        <details className="projetos-concluidos" open={concluidos.some((p) => p.concluidoComPendencias) || undefined}>
          <summary className="projetos-secao">Concluídos ({concluidos.length})</summary>
          <div className="projetos-lista">
            {concluidos.map((p) => (
              <LinhaDoProjeto key={p.id} projeto={p} onAbrir={onAbrir} selecionado={p.id === abertoId} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// ---------- Página do projeto ----------

// Nome, tipo, situação, prazo, IA: decide-se uma vez e quase nunca se mexe.
// Por isso moram num diálogo atrás do botão "Configurar", e não na página —
// lá eles disputavam a atenção com o que faz o projeto andar.
function ConfigurarProjeto({ projeto, pendentes = 0, onSalvar, onFechar }) {
  const [nome, setNome] = useState(projeto.nome)
  const [resultado, setResultado] = useState(projeto.resultado || '')
  const [situacao, setSituacao] = useState(projeto.situacao)
  const [tipo, setTipo] = useState(projeto.tipo || 'projeto')
  const [prazo, setPrazo] = useState(projeto.prazo || '')
  const [semIA, setSemIA] = useState(Boolean(projeto.semIA))

  function salvar(e) {
    e.preventDefault()
    onSalvar({ id: projeto.id, nome: nome.trim() || projeto.id, resultado, situacao, tipo, prazo: prazo || null, semIA })
    onFechar()
  }

  return (
    <Modal title="Configurar projeto" onClose={onFechar}>
      <form className="projeto-ficha" onSubmit={salvar}>
        <label className="field">
          <span>Nome</span>
          <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        {/* Sem um "pronto" descrito, o projeto nunca termina — só vai
            sendo abandonado. Rotina não termina: pergunta-se para que serve. */}
        <label className="field">
          <span>{tipo === 'rotina' ? 'Para que serve' : 'Como sei que terminou'}</span>
          <textarea rows={2} value={resultado} onChange={(e) => setResultado(e.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Situação</span>
            <select value={situacao} onChange={(e) => setSituacao(e.target.value)}>
              {SITUACOES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Prazo</span>
            <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </label>
        </div>
        {situacao === 'concluido' && pendentes > 0 && (
          <div className="form-error" role="status">
            Ainda há {pendentes} {pendentes === 1 ? 'tarefa pendente' : 'tarefas pendentes'} neste projeto. Conclua ou mova
            antes, ou elas ficam penduradas num projeto encerrado.
          </div>
        )}
        <label className="field">
          <span>Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        {/* Caso atendido, com nomes e situações: a pessoa decide se aquilo
            pode ir para a IA. Marcado, o assistente some deste projeto. */}
        <label className="entrada-dia-inteiro">
          <input type="checkbox" checked={semIA} onChange={(e) => setSemIA(e.target.checked)} />
          Não usar IA neste projeto
        </label>
        <div className="modal-actions">
          <span className="muted t-label">#{projeto.id}</span>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="primary">Salvar</button>
        </div>
      </form>
    </Modal>
  )
}

// Os arquivos do projeto: o componente Anexos, com a pasta do projeto no
// Drive como destino. A pasta nasce no primeiro arquivo e fica guardada na
// ficha.
function Arquivos({ projeto, onSalvar }) {
  const projetoRef = useRef(projeto)
  projetoRef.current = projeto

  async function garantirPasta() {
    const { pasta, nova } = await pastaDoProjeto(projetoRef.current)
    if (nova || projetoRef.current.pasta?.id !== pasta.id) onSalvar({ id: projeto.id, pasta })
    return pasta
  }

  return (
    <Anexos
      arquivos={projeto.arquivos || []}
      onMudar={(arquivos) => onSalvar({ id: projeto.id, arquivos })}
      garantirPasta={garantirPasta}
      nomeDoNovoPadrao={projeto.nome}
      pastaUrl={projeto.pasta?.url}
    />
  )
}

function hojeIso() {
  return toDateInput(new Date())
}

// Os marcos do projeto: onde ele precisa estar, e quando. Um clique marca
// como alcançado; o que venceu sem ser alcançado fica em vermelho.
function Marcos({ projeto, onSalvar }) {
  const [titulo, setTitulo] = useState('')
  const [data, setData] = useState('')
  const [adicionando, setAdicionando] = useState(false)
  const marcos = projeto.marcos || []
  const hoje = hojeIso()

  function adicionar(e) {
    e.preventDefault()
    onSalvar({ id: projeto.id, marcos: adicionarMarco(marcos, { titulo, data: data || null }) })
    setTitulo('')
    setData('')
    setAdicionando(false)
  }

  return (
    <div className="projeto-marcos">
      {marcos.map((m) => {
        const atrasado = !m.feito && m.data && m.data < hoje
        return (
          <div key={m.id} className={`projeto-marco${m.feito ? ' is-feito' : ''}${atrasado ? ' is-atrasado' : ''}`}>
            <label className="projeto-marco-check">
              <input type="checkbox" checked={m.feito} onChange={() => onSalvar({ id: projeto.id, marcos: alternarMarco(marcos, m.id) })} />
              <span className="projeto-marco-titulo">{m.titulo}</span>
            </label>
            {m.data && <span className="projeto-evento-quando">{atrasado ? 'venceu ' : ''}{dataCurta(m.data)}</span>}
            <button type="button" className="icon-btn" aria-label={`Remover o marco ${m.titulo}`} title="Remover" onClick={() => onSalvar({ id: projeto.id, marcos: removerMarco(marcos, m.id) })}>
              ×
            </button>
          </div>
        )
      })}
      {adicionando ? (
        <form className="projeto-arquivo-novo" onSubmit={adicionar}>
          <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: diagnóstico entregue" autoFocus />
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} aria-label="Data do marco" />
          <button type="submit" disabled={!titulo.trim()}>Adicionar</button>
        </form>
      ) : (
        <button type="button" className="link-btn projeto-mais" onClick={() => setAdicionando(true)}>+ Marco</button>
      )}
    </div>
  )
}

function LinhaDeTarefa({ task, origem, onEditar, onConcluir }) {
  const atrasada = isOverdueTask(task)
  const concluida = task.status === 'completed'
  return (
    <div className={`aguardando-item projeto-tarefa${atrasada ? ' is-atrasada' : ''}`} onClick={() => onEditar(task)}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={`projeto-tarefa-titulo${concluida ? ' is-concluida' : ''}`}>{task.title}</div>
        <div className="muted t-label-sm">
          {!concluida && <span className={`pill ${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>}
          {origem && <span style={{ marginLeft: 8 }}>{origem}</span>}
          {task.contexto && <span style={{ marginLeft: 8 }}>@{task.contexto}</span>}
          {task.due && !concluida && (
            <span style={{ marginLeft: 8, color: atrasada ? 'var(--urgent)' : undefined }}>
              {atrasada ? 'atrasada · ' : 'prazo '}
              {dataCurta(task.due)}
            </span>
          )}
          {concluida && task.completed && <span>concluída {dataCurta(task.completed)}</span>}
        </div>
      </div>
      {!concluida && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Concluir"
          title="Concluir"
          onClick={(e) => {
            e.stopPropagation()
            onConcluir(task)
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 12 9 17 20 6" />
          </svg>
        </button>
      )}
    </div>
  )
}

// Captura dentro do projeto: o mesmo campo único do Criar, mas o que nasce
// aqui já nasce no projeto. Com hora vira compromisso marcado com o projeto;
// sem hora vira próxima ação — a Entrada é pulada de propósito, porque quem
// escreve dentro do projeto já decidiu a que ele pertence.
function CapturaNoProjeto({ projetoId, idProximas, onCreateEvent, onCreateTask }) {
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState(null)
  const preview = texto.trim() ? parseQuickAdd(texto.trim()) : null

  async function enviar(e) {
    e.preventDefault()
    if (!preview || enviando) return
    setEnviando(true)
    setAviso(null)
    try {
      if (preview.type === 'event') {
        await onCreateEvent({
          title: preview.title,
          start: preview.start,
          end: preview.end,
          recurrence: preview.recorrencia ? construirRecorrencia(preview.recorrencia, preview.start) : undefined,
          allDay: preview.allDay,
          extendedProperties: { private: { [PROJETO_PROP]: projetoId } },
        })
        setAviso(`Compromisso "${preview.title}" criado.`)
      } else {
        await onCreateTask({
          title: preview.title,
          priority: preview.priority,
          due: preview.due,
          contexto: preview.contexto,
          projeto: projetoId,
          tasklistId: idProximas || '@default',
        })
        setAviso(`"${preview.title}" adicionada.`)
      }
      setTexto('')
    } catch (err) {
      setAviso(`Não deu para criar: ${err.message}`)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="projeto-captura" onSubmit={enviar}>
      <div className="projetos-novo">
        <input
          type="text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Adicionar ação ou compromisso"
        />
        <button type="submit" className="primary" disabled={!preview || enviando}>
          {enviando ? 'Criando...' : 'Adicionar'}
        </button>
      </div>
      {preview && (
        <div className="muted t-label">
          {preview.type === 'event'
            ? `Vira compromisso: ${descreverQuando(preview)}`
            : `Vira próxima ação${preview.due ? ` com prazo ${preview.due.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}` : ''}`}
        </div>
      )}
      {aviso && <div className="muted t-label">{aviso}</div>}
    </form>
  )
}

// Os compromissos do projeto: dois meses para trás (o que já aconteceu no
// caso) e seis para frente. Uma janela, não a agenda inteira — buscar em
// todas as agendas é a parte cara.
function useCompromissos(projetoId, buscarEventos, versao) {
  const [eventos, setEventos] = useState(null)
  useEffect(() => {
    let vivo = true
    const hoje = new Date()
    buscarEventos({ timeMin: addDays(hoje, -60), timeMax: addDays(hoje, 180) })
      .then((lista) => vivo && setEventos(lista.filter((ev) => eventoDoProjeto(ev, projetoId))))
      .catch(() => vivo && setEventos([]))
    return () => {
      vivo = false
    }
  }, [projetoId, buscarEventos, versao])
  return eventos
}

// Concluídas dos últimos seis meses, buscadas para esta página: a lista geral
// só traz concluídas com o "Mostrar concluídas" ligado.
function useConcluidas(buscarConcluidas) {
  const [lista, setLista] = useState([])
  useEffect(() => {
    if (!buscarConcluidas) return undefined
    let vivo = true
    buscarConcluidas({ completedMin: addDays(new Date(), -180) })
      .then((r) => vivo && setLista(r))
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [buscarConcluidas])
  return [lista, setLista]
}

function rotuloDaOrigem(grupo, task) {
  if (grupo === 'aguardando') return task.aguardando?.quem ? `aguardando ${task.aguardando.quem}` : 'aguardando'
  if (grupo === 'algumDia') return 'algum dia'
  if (grupo === 'entrada') return 'na Entrada'
  if (grupo === 'outras') return task.tasklistTitle || null
  return null
}

const HISTORICO_INICIAL = 6

// Dentro do projeto a etiqueta "#caso-maria" no título só repete o óbvio.
function semEtiqueta(titulo, projetoId) {
  const escapado = projetoId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (titulo || '').replace(new RegExp(`\\s*#${escapado}(?![\\w-])`, 'gi'), '').trim() || titulo || '(sem título)'
}

function dataDoHistorico(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function PaginaDoProjeto({
  projeto,
  tasks,
  notes,
  ids,
  onVoltar,
  onSalvar,
  onEditarTarefa,
  onConcluirTarefa,
  onAbrirNota,
  onNovaNota,
  onCreateEvent,
  onCreateTask,
  onAtualizarTarefa,
  onSalvarAnotacao,
  buscarEventos,
  buscarConcluidas,
  onEditarEvento,
}) {
  const grupos = tarefasDoProjeto(tasks, projeto.id, ids)
  const anotacoes = notes
    .filter((n) => n.projeto === projeto.id)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
  const [versaoEventos, setVersaoEventos] = useState(0)
  const [configurando, setConfigurando] = useState(false)
  const [concluindoPendencias, setConcluindoPendencias] = useState(false)
  const [historicoTodo, setHistoricoTodo] = useState(false)
  const eventos = useCompromissos(projeto.id, buscarEventos, versaoEventos)
  const [concluidasBuscadas, setConcluidasBuscadas] = useConcluidas(buscarConcluidas)
  const rotina = projeto.tipo === 'rotina'

  // Uma lista só do que falta, na ordem de importância; de que lista cada
  // uma vem aparece como etiqueta discreta, em vez de cinco subtítulos.
  const aFazer = ['proximas', 'aguardando', 'entrada', 'outras', 'algumDia'].flatMap((g) =>
    grupos[g].map((t) => ({ task: t, origem: rotuloDaOrigem(g, t) }))
  )

  const agora = new Date()
  const proximos = (eventos || []).filter((ev) => eventStart(ev) >= agora)
  const passados = (eventos || []).filter((ev) => eventStart(ev) < agora).reverse()
  const concluidasDoProjeto = juntarConcluidas(grupos.concluidas, concluidasBuscadas.filter((t) => t.projeto === projeto.id)).sort(
    (a, b) => new Date(b.completed || 0) - new Date(a.completed || 0)
  )
  const linhaDoTempo = linhaDoTempoDoProjeto(
    { projeto, concluidas: concluidasDoProjeto, eventosPassados: passados, notas: anotacoes },
    eventStart
  )
  const atrasadas = aFazer.filter(({ task }) => isOverdueTask(task)).length

  // A aba aberta é a única coisa da página que não vem do projeto: começa
  // sempre no Resumo, que é a resposta para "em que pé está".
  const [aba, setAba] = useState('resumo')
  const abas = [
    { id: 'resumo', rotulo: 'Resumo' },
    { id: 'tarefas', rotulo: 'Tarefas', contagem: aFazer.length },
    { id: 'anotacoes', rotulo: 'Anotações', contagem: anotacoes.length },
    { id: 'arquivos', rotulo: 'Arquivos', contagem: (projeto.arquivos || []).length },
    { id: 'compromissos', rotulo: 'Compromissos', contagem: proximos.length },
    { id: 'linha', rotulo: 'Linha do tempo' },
  ]

  function abrirDaLinha(h) {
    if (h.tipo === 'tarefa') onEditarTarefa(h.item)
    else if (h.tipo === 'compromisso') onEditarEvento(h.item)
    else if (h.tipo === 'nota') onAbrirNota(h.item.id)
    else if (h.tipo === 'arquivo') window.open(h.item.url, '_blank', 'noopener,noreferrer')
  }

  const linhaDoEvento = (ev) => (
    <button key={`${ev.calendarId}-${ev.id}`} type="button" className="projeto-evento" onClick={() => onEditarEvento(ev)}>
      <span className="projeto-evento-quando">{quandoDoEvento(ev)}</span>
      <span className="projeto-evento-titulo">{semEtiqueta(ev.summary, projeto.id)}</span>
    </button>
  )

  const destaque = projeto.proximaAcao ? (
    <div className="projeto-destaque">
      <span className="t-label-sm">{rotina ? 'Próximo item da pauta' : 'Próxima ação'}</span>
      <strong className="projeto-destaque-texto">{projeto.proximaAcao.title}</strong>
      {/* Uma "ação" do tamanho de um parágrafo é uma ideia inteira:
          quem lê não sabe por onde começar. */}
      {pareceIdeia(projeto.proximaAcao.title) && (
        <div className="projeto-aviso-ideia">
          <span>Parece uma ideia, não um passo.</span>
          <button type="button" onClick={() => onEditarTarefa(projeto.proximaAcao)}>Reescrever</button>
        </div>
      )}
    </div>
  ) : projeto.semProximaAcao ? (
    <div className="projeto-destaque is-vazio">
      <span className="t-label-sm">Próxima ação</span>
      <strong className="projeto-destaque-texto">Nenhuma. Qual é o próximo passo?</strong>
    </div>
  ) : null

  const captura = (
    <CapturaNoProjeto
      projetoId={projeto.id}
      idProximas={ids.idProximas}
      onCreateEvent={async (preview) => {
        const r = await onCreateEvent(preview)
        setVersaoEventos((v) => v + 1)
        return r
      }}
      onCreateTask={onCreateTask}
    />
  )

  async function concluir(task) {
    await onConcluirTarefa(task)
    // Aparece em "Feito" na hora, sem esperar uma nova busca.
    setConcluidasBuscadas((l) => [{ ...task, status: 'completed', completed: new Date().toISOString() }, ...l])
  }

  // Uma de cada vez, na ordem: em paralelo, o Google Tasks recusa parte das
  // gravações por excesso de pedidos e algumas ficariam para trás.
  async function concluirPendencias() {
    setConcluindoPendencias(false)
    for (const { task } of aFazer) await concluir(task)
  }

  return (
    <div className="projetos projeto-pagina">
      <header className="projeto-topo">
        {/* Só no celular: no computador a lista fica ao lado e já é o caminho
            de volta. */}
        <button type="button" className="projeto-voltar" onClick={onVoltar} aria-label="Voltar para a lista de projetos">
          ← Projetos
        </button>
        <div className="projeto-topo-texto">
          <h2 className="t-headline projeto-titulo">
            {projeto.nome}
            {projeto.situacao !== 'ativo' && (
              <span className="pill projeto-pill-situacao">{SITUACOES.find((x) => x.id === projeto.situacao)?.label}</span>
            )}
          </h2>
        </div>
        <button type="button" className="projeto-configurar" onClick={() => setConfigurando(true)}>
          Configurar
        </button>
      </header>

      {/* O que está incoerente vem antes de tudo: é o que faz a lista de
          projetos mentir sobre o que está em andamento. */}
      {projeto.implicito && (
        <Banner tone="info" actionLabel="Criar a ficha" onAction={() => onSalvar({ id: projeto.id, nome: projeto.nome })}>
          Este projeto existe só como etiqueta nas tarefas. A ficha dá a ele situação, resultado esperado e pasta de arquivos.
        </Banner>
      )}
      {projeto.concluidoComPendencias && (
        <Banner tone="warning" actionLabel="Reabrir o projeto" onAction={() => onSalvar({ id: projeto.id, situacao: 'ativo' })}>
          Marcado como concluído, mas ainda tem {aFazer.length} {aFazer.length === 1 ? 'tarefa pendente' : 'tarefas pendentes'}.
          Ou o projeto não terminou, ou elas ficaram esquecidas.{' '}
          <button type="button" className="link-btn" onClick={() => setConcluindoPendencias(true)}>
            Concluir as pendências
          </button>
        </Banner>
      )}

      {/* Primary tabs do MD3: seis visões do mesmo projeto, uma de cada vez.
          Antes tudo vinha numa página só, em duas colunas, e um projeto com
          histórico longo virava uma rolagem sem fim. */}
      <div className="projeto-abas" role="tablist" aria-label="Partes do projeto">
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            id={`projeto-aba-${a.id}`}
            aria-selected={aba === a.id}
            aria-controls={`projeto-painel-${a.id}`}
            className={`projeto-aba${aba === a.id ? ' is-ativa' : ''}`}
            onClick={() => setAba(a.id)}
          >
            {a.rotulo}
            {a.contagem > 0 && <span className="projeto-aba-contagem">{a.contagem}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`projeto-painel-${aba}`} aria-labelledby={`projeto-aba-${aba}`} className="projeto-painel">
        {aba === 'resumo' && (
          <>
            {destaque}
            {captura}
            <dl className="projeto-ficha-resumo">
              <div>
                <dt>{rotina ? 'Para que serve' : 'Resultado esperado'}</dt>
                <dd>
                  {projeto.resultado?.trim() || (
                    <button type="button" className="link-btn" onClick={() => setConfigurando(true)}>
                      {rotina ? 'Dizer para que serve' : 'Definir como se sabe que terminou'}
                    </button>
                  )}
                </dd>
              </div>
              <div>
                <dt>Situação</dt>
                <dd>{SITUACOES.find((x) => x.id === projeto.situacao)?.label} · {rotina ? 'rotina' : 'projeto'}</dd>
              </div>
              <div>
                <dt>Prazo</dt>
                <dd>{projeto.prazo ? dataCurta(projeto.prazo) : <span className="muted">sem prazo</span>}</dd>
              </div>
            </dl>

            {/* Cada número leva à aba dele: o resumo responde "em que pé
                está" e é a porta de entrada para o resto. */}
            <div className="projeto-numeros">
              <button type="button" className="projeto-numero" onClick={() => setAba('tarefas')}>
                <strong>{aFazer.length}</strong>
                <span>{rotina ? 'na pauta' : 'a fazer'}</span>
                {atrasadas > 0 && <span className="projeto-numero-alerta">{atrasadas} atrasada(s)</span>}
              </button>
              <button type="button" className="projeto-numero" onClick={() => setAba('anotacoes')}>
                <strong>{anotacoes.length}</strong>
                <span>{anotacoes.length === 1 ? 'anotação' : 'anotações'}</span>
              </button>
              <button type="button" className="projeto-numero" onClick={() => setAba('arquivos')}>
                <strong>{(projeto.arquivos || []).length}</strong>
                <span>{(projeto.arquivos || []).length === 1 ? 'arquivo' : 'arquivos'}</span>
              </button>
              <button type="button" className="projeto-numero" onClick={() => setAba('compromissos')}>
                <strong>{eventos === null ? '…' : proximos.length}</strong>
                <span>{proximos[0] ? `próximo ${quandoDoEvento(proximos[0])}` : 'compromissos à frente'}</span>
              </button>
            </div>

            {!rotina && (
              <section>
                <h3 className="projetos-secao">Marcos</h3>
                <Marcos projeto={projeto} onSalvar={onSalvar} />
              </section>
            )}

            <AssistenteDoProjeto
              projeto={projeto}
              grupos={grupos}
              anotacoes={anotacoes}
              contextos={[...new Set(tasks.map((t) => t.contexto).filter(Boolean))]}
              idProximas={ids.idProximas}
              onCreateTask={onCreateTask}
              onSalvar={onSalvar}
              onAtualizarTarefa={onAtualizarTarefa}
              onSalvarAnotacao={onSalvarAnotacao}
              onAbrirNota={onAbrirNota}
            />
          </>
        )}

        {aba === 'tarefas' && (
          <>
            {captura}
            <section>
              <h3 className="projetos-secao">{rotina ? 'Pauta' : 'A fazer'} · {aFazer.length}</h3>
              {aFazer.length === 0 ? (
                <p className="muted projeto-vazio">Nada pendente. Escreva acima a próxima ação.</p>
              ) : (
                <div className="aguardando-lista">
                  {aFazer.map(({ task, origem }) => (
                    <LinhaDeTarefa key={task.id} task={task} origem={origem} onEditar={onEditarTarefa} onConcluir={concluir} />
                  ))}
                </div>
              )}
            </section>
            <section>
              <h3 className="projetos-secao">Concluídas · {concluidasDoProjeto.length}</h3>
              {concluidasDoProjeto.length === 0 ? (
                <p className="muted projeto-vazio">Nada concluído ainda.</p>
              ) : (
                <div className="aguardando-lista">
                  {concluidasDoProjeto.slice(0, historicoTodo ? undefined : HISTORICO_INICIAL).map((t) => (
                    <LinhaDeTarefa key={t.id} task={t} onEditar={onEditarTarefa} onConcluir={concluir} />
                  ))}
                </div>
              )}
              {concluidasDoProjeto.length > HISTORICO_INICIAL && (
                <button type="button" className="link-btn projeto-mais" onClick={() => setHistoricoTodo((v) => !v)}>
                  {historicoTodo ? 'Mostrar menos' : `Ver todas (${concluidasDoProjeto.length})`}
                </button>
              )}
            </section>
          </>
        )}

        {aba === 'anotacoes' && (
          <section>
            <div className="projeto-secao-cabeca">
              <h3 className="projetos-secao">Anotações · {anotacoes.length}</h3>
              <button type="button" className="link-btn" onClick={() => onNovaNota(projeto.id)}>+ Nova anotação</button>
            </div>
            {anotacoes.length === 0 ? (
              <p className="muted projeto-vazio">
                Nenhuma anotação. Registros de atendimento, atas e combinados do projeto ficam aqui, ligados a ele.
              </p>
            ) : (
              <div className="projeto-notas">
                {anotacoes.map((n) => {
                  const titulo = n.title?.trim() || n.body?.trim().split('\n')[0] || '(sem título)'
                  const trecho = trechoDaAnotacao(textoSemFormato(n.title?.trim() ? n.body : n.body?.trim().split('\n').slice(1).join('\n')))
                  return (
                    <button key={n.id} type="button" className="projeto-nota" onClick={() => onAbrirNota(n.id)}>
                      <span className="projeto-nota-topo">
                        <span className="projeto-nota-titulo">{titulo}</span>
                        <span className="projeto-evento-quando">{dataCurta(n.updatedAt)}</span>
                      </span>
                      {trecho && <span className="projeto-nota-trecho">{trecho}</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {aba === 'arquivos' && <Arquivos projeto={projeto} onSalvar={onSalvar} />}

        {aba === 'compromissos' && (
          <>
            {captura}
            <section>
              <h3 className="projetos-secao">À frente · {proximos.length}</h3>
              {eventos === null ? (
                <p className="muted projeto-vazio">Carregando a agenda…</p>
              ) : proximos.length === 0 ? (
                <p className="muted projeto-vazio">Nenhum compromisso marcado. Escreva acima com dia e hora ("reunião de rede quinta 14h").</p>
              ) : (
                <div className="aguardando-lista">{proximos.map(linhaDoEvento)}</div>
              )}
            </section>
            {passados.length > 0 && (
              <section>
                <h3 className="projetos-secao">Já aconteceram · {passados.length}</h3>
                <div className="aguardando-lista">{passados.map(linhaDoEvento)}</div>
              </section>
            )}
          </>
        )}

        {aba === 'linha' && (
          <section>
            {linhaDoTempo.length === 0 ? (
              <p className="muted projeto-vazio">Nada aconteceu neste projeto ainda.</p>
            ) : (
              <ol className="projeto-historico projeto-linha-do-tempo">
                {linhaDoTempo.slice(0, historicoTodo ? undefined : 30).map((h) => (
                  <li key={h.id}>
                    <button type="button" className="projeto-historico-item" onClick={() => abrirDaLinha(h)}>
                      <span className="projeto-historico-data">{dataDoHistorico(h.data)}</span>
                      <span className="projeto-historico-titulo">
                        <span className="t-label-sm muted projeto-linha-rotulo">{h.rotulo}</span>
                        {semEtiqueta(h.titulo, projeto.id)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {linhaDoTempo.length > 30 && (
              <button type="button" className="link-btn projeto-mais" onClick={() => setHistoricoTodo((v) => !v)}>
                {historicoTodo ? 'Mostrar menos' : `Ver tudo (${linhaDoTempo.length})`}
              </button>
            )}
          </section>
        )}
      </div>

      {configurando && (
        <ConfigurarProjeto projeto={projeto} pendentes={aFazer.length} onSalvar={onSalvar} onFechar={() => setConfigurando(false)} />
      )}
      {concluindoPendencias && (
        <ConfirmDialog
          title="Concluir as pendências"
          message={`Marcar como feitas as ${aFazer.length} tarefas pendentes de "${projeto.nome}"? Dá para reabrir cada uma depois, nas concluídas.`}
          confirmLabel="Concluir todas"
          onConfirm={concluirPendencias}
          onCancel={() => setConcluindoPendencias(false)}
        />
      )}
    </div>
  )
}

// O que aparece no lugar vazio quando nenhum projeto está aberto: a revisão
// dos projetos, respondida de olhar. Cada linha leva direto ao projeto (ou à
// tarefa) que pede atenção.
function PainelGeral({ lista, tasks, onAbrir, onEditarTarefa }) {
  const p = panoramaDosProjetos(lista, tasks)
  const blocos = [
    { id: 'parados', titulo: 'Sem próxima ação', dica: 'Parados: falta decidir o próximo passo.', itens: p.parados, tom: 'aviso' },
    { id: 'atrasados', titulo: 'Com tarefa atrasada', itens: p.atrasados, tom: 'urgente', extra: (x) => `${x.atrasadas} atrasada(s)` },
    { id: 'vaga', titulo: 'Próxima ação vaga', dica: 'A ação escrita é uma ideia inteira; reescreva como primeiro passo.', itens: p.acaoVaga },
    { id: 'esquecidos', titulo: 'Esquecidos', dica: 'Sem nenhum movimento há duas semanas ou mais.', itens: p.esquecidos, extra: (x) => `há ${x.diasSemAtividade} dias` },
    { id: 'semResultado', titulo: 'Sem resultado definido', dica: 'Falta dizer como se sabe que terminou.', itens: p.semResultado },
    {
      id: 'concluidosPendentes',
      titulo: 'Concluídos com tarefas pendentes',
      dica: 'Reabra o projeto ou conclua as tarefas que sobraram.',
      itens: p.concluidosComPendencias,
      tom: 'aviso',
      extra: (x) => `${x.pendentes} pendente(s)`,
    },
    { id: 'semFicha', titulo: 'Sem ficha', dica: 'Etiquetas usadas em tarefas que ainda não viraram projeto.', itens: p.semFicha },
  ]
  const ativos = lista.filter((x) => x.situacao === 'ativo')
  const tudoEmDia = blocos.every((b) => b.itens.length === 0) && p.prazos.length === 0

  return (
    <div className="painel-geral">
      <header>
        <h2 className="t-headline" style={{ margin: 0 }}>Visão geral</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          {ativos.length} ativo(s). {tudoEmDia ? 'Tudo andando — nada pedindo atenção agora.' : 'O que pede atenção, de cima para baixo.'}
        </p>
      </header>

      {p.prazos.length > 0 && (
        <section className="painel-geral-bloco">
          <h3 className="projetos-secao">Prazos nos próximos 14 dias</h3>
          {p.prazos.map((x, i) => (
            <button
              key={i}
              type="button"
              className="painel-geral-linha"
              onClick={() => (x.task && onEditarTarefa ? onEditarTarefa(x.task) : onAbrir(x.projeto.id))}
            >
              <span className="painel-geral-data">{x.data.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
              <span className="painel-geral-texto">
                <strong>{x.titulo}</strong>
                <span className="muted t-label-sm">{x.projeto.nome}</span>
              </span>
            </button>
          ))}
        </section>
      )}

      {blocos
        .filter((b) => b.itens.length > 0)
        .map((b) => (
          <section key={b.id} className="painel-geral-bloco">
            <h3 className="projetos-secao" title={b.dica}>
              {b.titulo} · {b.itens.length}
            </h3>
            {b.itens.map((x) => (
              <button key={x.id} type="button" className={`painel-geral-linha${b.tom ? ` is-${b.tom}` : ''}`} onClick={() => onAbrir(x.id)}>
                <span className="painel-geral-texto">
                  <strong>{x.nome}</strong>
                  {x.proximaAcao && b.id === 'vaga' && <span className="muted t-label-sm painel-geral-acao">{x.proximaAcao.title}</span>}
                </span>
                {b.extra && <span className="muted t-label-sm">{b.extra(x)}</span>}
              </button>
            ))}
          </section>
        ))}
    </div>
  )
}

// A tela de Projetos: a lista e a página do projeto aberto — um lugar só
// onde o caso inteiro (tarefas, anotações, compromissos) fica à vista. Com
// largura (computador), as duas ficam lado a lado, como uma caixa de e-mail:
// trocar de projeto é um clique, sem voltar. Sem largura (celular), uma de
// cada vez — quem decide é o CSS, pela largura da própria tela.
export default function ProjetosPainel({ lista, projetosState, tasks, notes, ids, abertoInicial = null, ...acoes }) {
  // `abertoInicial`: a revisão (etapa Projetos) abre esta tela já no projeto.
  const [abertoId, setAbertoId] = useState(abertoInicial)
  const aberto = lista.find((p) => p.id === abertoId)

  function criar(nome) {
    const ficha = novoProjeto(nome)
    if (!ficha) return null
    // Nome que dá numa etiqueta já existente abre o projeto que já existe,
    // em vez de sobrescrever a ficha dele com uma em branco.
    if (!lista.some((p) => p.id === ficha.id && !p.implicito)) projetosState.salvarProjeto(ficha)
    return ficha.id
  }

  return (
    <>
      {projetosState.error && (
        <Banner tone="warning" actionLabel="✕" onAction={projetosState.dismissError}>
          {projetosState.error}
        </Banner>
      )}
      <div className={`projetos-tela${aberto ? ' tem-aberto' : ''}`}>
        <div className="projetos-mestre">
          <ListaDeProjetos lista={lista} onAbrir={setAbertoId} onCriar={criar} abertoId={aberto?.id} />
        </div>
        <div className="projetos-detalhe">
          {aberto ? (
            <PaginaDoProjeto
              key={aberto.id}
              projeto={aberto}
              tasks={tasks}
              notes={notes}
              ids={ids}
              onVoltar={() => setAbertoId(null)}
              onSalvar={projetosState.salvarProjeto}
              {...acoes}
            />
          ) : (
            lista.length > 0 ? (
              <PainelGeral lista={lista} tasks={tasks} onAbrir={setAbertoId} onEditarTarefa={acoes.onEditarTarefa} />
            ) : (
              <div className="projetos-vazio muted">Crie o primeiro projeto ao lado.</div>
            )
          )}
        </div>
      </div>
    </>
  )
}
