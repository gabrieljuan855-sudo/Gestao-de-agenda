import { useEffect, useState } from 'react'
import Banner from './Banner.jsx'
import { PRIORITY_LABEL } from '../lib/priority.js'
import { isOverdueTask } from '../lib/tasks.js'
import { dateOnlyFromISO, addDays } from '../lib/dates.js'
import { eventStart, isAllDay } from '../lib/events.js'
import { parseQuickAdd } from '../lib/nlp.js'
import { construirRecorrencia } from '../lib/recorrencia.js'
import { SITUACOES, PROJETO_PROP, novoProjeto, tarefasDoProjeto, eventoDoProjeto } from '../lib/projetos.js'

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

function LinhaDoProjeto({ projeto, onAbrir }) {
  const partes = []
  if (projeto.pendentes) partes.push(`${projeto.pendentes} ${projeto.pendentes === 1 ? 'tarefa' : 'tarefas'}`)
  if (projeto.anotacoes) partes.push(`${projeto.anotacoes} ${projeto.anotacoes === 1 ? 'anotação' : 'anotações'}`)
  if (projeto.prazo) partes.push(`prazo ${dataCurta(projeto.prazo)}`)
  return (
    <button type="button" className="projeto-linha" onClick={() => onAbrir(projeto.id)}>
      <span className="projeto-linha-topo">
        <span className="projeto-linha-nome">{projeto.nome}</span>
        {projeto.semProximaAcao && <span className="pill projeto-pill-parado">sem próxima ação</span>}
        {projeto.atrasadas > 0 && (
          <span className="pill projeto-pill-atraso">
            {projeto.atrasadas} {projeto.atrasadas === 1 ? 'atrasada' : 'atrasadas'}
          </span>
        )}
      </span>
      {projeto.proximaAcao && <span className="projeto-linha-acao">→ {projeto.proximaAcao.title}</span>}
      {partes.length > 0 && <span className="muted t-label">{partes.join(' · ')}</span>}
    </button>
  )
}

function ListaDeProjetos({ lista, onAbrir, onCriar }) {
  const [nome, setNome] = useState('')
  const porSituacao = (s) => lista.filter((p) => p.situacao === s)
  const concluidos = porSituacao('concluido')

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

      {['ativo', 'pausado'].map((s) =>
        porSituacao(s).length > 0 ? (
          <section key={s}>
            <h3 className="projetos-secao">{s === 'ativo' ? 'Ativos' : 'Pausados'}</h3>
            <div className="projetos-lista">
              {porSituacao(s).map((p) => <LinhaDoProjeto key={p.id} projeto={p} onAbrir={onAbrir} />)}
            </div>
          </section>
        ) : null
      )}

      {/* Concluído não some — é o histórico dos casos —, mas também não
          disputa atenção com o que ainda está andando. */}
      {concluidos.length > 0 && (
        <details className="projetos-concluidos">
          <summary className="projetos-secao">Concluídos ({concluidos.length})</summary>
          <div className="projetos-lista">
            {concluidos.map((p) => <LinhaDoProjeto key={p.id} projeto={p} onAbrir={onAbrir} />)}
          </div>
        </details>
      )}
    </div>
  )
}

// ---------- Página do projeto ----------

function Ficha({ projeto, onSalvar }) {
  const [nome, setNome] = useState(projeto.nome)
  const [resultado, setResultado] = useState(projeto.resultado || '')
  const [situacao, setSituacao] = useState(projeto.situacao)
  const [prazo, setPrazo] = useState(projeto.prazo || '')
  const [salvo, setSalvo] = useState(false)

  useEffect(() => {
    setNome(projeto.nome)
    setResultado(projeto.resultado || '')
    setSituacao(projeto.situacao)
    setPrazo(projeto.prazo || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projeto.id, projeto.updatedAt])

  const mudou =
    projeto.implicito ||
    nome.trim() !== projeto.nome ||
    resultado !== (projeto.resultado || '') ||
    situacao !== projeto.situacao ||
    prazo !== (projeto.prazo || '')

  function salvar(e) {
    e.preventDefault()
    onSalvar({ id: projeto.id, nome: nome.trim() || projeto.id, resultado, situacao, prazo: prazo || null })
    setSalvo(true)
    setTimeout(() => setSalvo(false), 2000)
  }

  return (
    <form className="projeto-ficha" onSubmit={salvar}>
      {projeto.implicito && (
        <p className="muted" style={{ margin: 0 }}>
          Este projeto existe só pela etiqueta #{projeto.id} nas tarefas. Salve a ficha para dar a ele um nome e um
          resultado esperado.
        </p>
      )}
      <label className="field">
        <span>Nome</span>
        <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} />
      </label>
      {/* A pergunta do GTD para um projeto: sem um "pronto" descrito, ele
          nunca termina — só vai sendo abandonado. */}
      <label className="field">
        <span>Como sei que terminou?</span>
        <textarea rows={2} value={resultado} onChange={(e) => setResultado(e.target.value)} placeholder="O resultado esperado (ex.: acordo homologado e arquivado)" />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Situação</span>
          <select value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            {SITUACOES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Prazo</span>
          <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        </label>
      </div>
      <div className="modal-actions">
        <span className="muted">{salvo ? 'Ficha salva.' : `#${projeto.id}`}</span>
        <div style={{ flex: 1 }} />
        <button type="submit" className="primary" disabled={!mudou}>Salvar ficha</button>
      </div>
    </form>
  )
}

function LinhaDeTarefa({ task, onEditar, onConcluir }) {
  const atrasada = isOverdueTask(task)
  const concluida = task.status === 'completed'
  return (
    <div className={`aguardando-item projeto-tarefa${atrasada ? ' is-atrasada' : ''}`} onClick={() => onEditar(task)}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={`projeto-tarefa-titulo${concluida ? ' is-concluida' : ''}`}>{task.title}</div>
        <div className="muted t-label-sm">
          {!concluida && <span className={`pill ${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>}
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

function GrupoDeTarefas({ titulo, tarefas, onEditar, onConcluir }) {
  if (tarefas.length === 0) return null
  return (
    <div className="projeto-grupo">
      <div className="entrada-secao">{titulo}</div>
      <div className="aguardando-lista">
        {tarefas.map((t) => <LinhaDeTarefa key={t.id} task={t} onEditar={onEditar} onConcluir={onConcluir} />)}
      </div>
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
          extendedProperties: { private: { [PROJETO_PROP]: projetoId } },
        })
        setAviso(`Compromisso "${preview.title}" criado no projeto.`)
      } else {
        await onCreateTask({
          title: preview.title,
          priority: preview.priority,
          due: preview.due,
          contexto: preview.contexto,
          projeto: projetoId,
          tasklistId: idProximas || '@default',
        })
        setAviso(`"${preview.title}" entrou nas próximas ações do projeto.`)
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
          placeholder="Nova ação ou compromisso (ex.: ligar para o cartório amanhã)"
        />
        <button type="submit" className="primary" disabled={!preview || enviando}>
          {enviando ? 'Criando...' : 'Adicionar'}
        </button>
      </div>
      {preview && (
        <div className="muted t-label">
          {preview.type === 'event'
            ? `Vira compromisso: ${preview.start.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
            : `Vira próxima ação${preview.due ? ` com prazo ${preview.due.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}` : ''}`}
        </div>
      )}
      {aviso && <div className="muted t-label">{aviso}</div>}
    </form>
  )
}

function Compromissos({ projetoId, buscarEventos, onEditarEvento, versao }) {
  const [eventos, setEventos] = useState(null)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    let vivo = true
    setErro(null)
    const hoje = new Date()
    // Uma janela e não a agenda inteira: dois meses para trás (o que já
    // aconteceu no caso) e seis para frente cobrem o que importa sem virar
    // uma busca pesada em todas as agendas.
    buscarEventos({ timeMin: addDays(hoje, -60).toISOString(), timeMax: addDays(hoje, 180).toISOString() })
      .then((lista) => {
        if (vivo) setEventos(lista.filter((ev) => eventoDoProjeto(ev, projetoId)))
      })
      .catch((err) => {
        if (vivo) setErro(err.message)
      })
    return () => {
      vivo = false
    }
  }, [projetoId, buscarEventos, versao])

  if (erro) return <p className="muted">Não deu para buscar os compromissos agora ({erro}).</p>
  if (eventos === null) return <p className="muted">Buscando compromissos...</p>

  const agora = new Date()
  const proximos = eventos.filter((ev) => eventStart(ev) >= agora)
  const passados = eventos.filter((ev) => eventStart(ev) < agora).reverse()

  if (eventos.length === 0) {
    return (
      <p className="muted">
        Nenhum compromisso ligado a este projeto. Crie um pelo campo acima, escolha o projeto ao editar um compromisso,
        ou escreva #{projetoId} no título dele.
      </p>
    )
  }

  const linha = (ev) => (
    <button key={`${ev.calendarId}-${ev.id}`} type="button" className="projeto-evento" onClick={() => onEditarEvento(ev)}>
      <span className="projeto-evento-quando">{quandoDoEvento(ev)}</span>
      <span className="projeto-evento-titulo">{ev.summary || '(sem título)'}</span>
    </button>
  )

  return (
    <div className="aguardando-lista">
      {proximos.map(linha)}
      {passados.length > 0 && (
        <details>
          <summary className="entrada-secao">Já aconteceram ({passados.length})</summary>
          <div className="aguardando-lista">{passados.map(linha)}</div>
        </details>
      )}
    </div>
  )
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
  buscarEventos,
  onEditarEvento,
}) {
  const grupos = tarefasDoProjeto(tasks, projeto.id, ids)
  const anotacoes = notes.filter((n) => n.projeto === projeto.id)
  // Recarregar os compromissos depois de criar um pelo campo do projeto —
  // sem isso o recém-criado só apareceria reabrindo a página.
  const [versaoEventos, setVersaoEventos] = useState(0)

  return (
    <div className="projetos">
      <div className="projeto-topo">
        <button type="button" onClick={onVoltar} aria-label="Voltar para a lista de projetos">
          ← Projetos
        </button>
        <h2 className="t-headline projeto-titulo">{projeto.nome}</h2>
      </div>

      {projeto.semProximaAcao && (
        <Banner tone="warning">Nenhuma próxima ação: este projeto parou de andar. Qual é o próximo passo concreto?</Banner>
      )}

      {projeto.proximaAcao && (
        <div className="projeto-destaque">
          <span className="t-label-sm">Próxima ação</span>
          <strong>{projeto.proximaAcao.title}</strong>
        </div>
      )}

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

      <section>
        <h3 className="projetos-secao">Tarefas</h3>
        {Object.values(grupos).every((g) => g.length === 0) && <p className="muted">Nenhuma tarefa neste projeto ainda.</p>}
        <GrupoDeTarefas titulo="Próximas ações" tarefas={grupos.proximas} onEditar={onEditarTarefa} onConcluir={onConcluirTarefa} />
        <GrupoDeTarefas titulo="Aguardando" tarefas={grupos.aguardando} onEditar={onEditarTarefa} onConcluir={onConcluirTarefa} />
        <GrupoDeTarefas titulo="Na Entrada" tarefas={grupos.entrada} onEditar={onEditarTarefa} onConcluir={onConcluirTarefa} />
        <GrupoDeTarefas titulo="Outras listas" tarefas={grupos.outras} onEditar={onEditarTarefa} onConcluir={onConcluirTarefa} />
        <GrupoDeTarefas titulo="Algum dia" tarefas={grupos.algumDia} onEditar={onEditarTarefa} onConcluir={onConcluirTarefa} />
        {grupos.concluidas.length > 0 && (
          <details>
            <summary className="entrada-secao">Concluídas recentes ({grupos.concluidas.length})</summary>
            <div className="aguardando-lista">
              {grupos.concluidas.map((t) => (
                <LinhaDeTarefa key={t.id} task={t} onEditar={onEditarTarefa} onConcluir={onConcluirTarefa} />
              ))}
            </div>
          </details>
        )}
      </section>

      <section>
        <div className="projeto-secao-cabeca">
          <h3 className="projetos-secao">Anotações</h3>
          <button type="button" onClick={() => onNovaNota(projeto.id)}>Nova anotação</button>
        </div>
        {anotacoes.length === 0 ? (
          <p className="muted">Nenhuma anotação neste projeto. Escolha o projeto dentro de uma anotação para ela aparecer aqui.</p>
        ) : (
          <div className="aguardando-lista">
            {anotacoes.map((n) => (
              <button key={n.id} type="button" className="projeto-evento" onClick={() => onAbrirNota(n.id)}>
                <span className="projeto-evento-titulo">{n.title?.trim() || n.body?.trim().split('\n')[0] || '(sem título)'}</span>
                <span className="projeto-evento-quando">editada {dataCurta(n.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="projetos-secao">Compromissos</h3>
        <Compromissos
          projetoId={projeto.id}
          buscarEventos={buscarEventos}
          onEditarEvento={onEditarEvento}
          versao={versaoEventos}
        />
      </section>

      <section>
        <h3 className="projetos-secao">Ficha</h3>
        <Ficha projeto={projeto} onSalvar={onSalvar} />
      </section>
    </div>
  )
}

// O painel de Projetos: a lista e, ao abrir um, a página dele — um lugar só
// onde o caso inteiro (tarefas, anotações, compromissos) fica à vista.
export default function ProjetosPainel({ lista, projetosState, tasks, notes, ids, ...acoes }) {
  const [abertoId, setAbertoId] = useState(null)
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
      {aberto ? (
        <PaginaDoProjeto
          projeto={aberto}
          tasks={tasks}
          notes={notes}
          ids={ids}
          onVoltar={() => setAbertoId(null)}
          onSalvar={projetosState.salvarProjeto}
          {...acoes}
        />
      ) : (
        <ListaDeProjetos lista={lista} onAbrir={setAbertoId} onCriar={criar} />
      )}
    </>
  )
}
