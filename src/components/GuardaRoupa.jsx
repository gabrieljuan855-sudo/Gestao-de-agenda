import { useMemo, useRef, useState } from 'react'
import Banner from './Banner.jsx'
import Modal from './Modal.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import FotoDaPeca from './FotoDaPeca.jsx'
import { permissaoDosArquivos, pedirAcessoAosArquivos } from '../lib/googleAuth.js'
import { descreverSincronizacao } from '../lib/useNotes.js'
import {
  CATEGORIAS,
  OCASIOES,
  TEMPERATURAS,
  ORDENS,
  PENDENTE,
  rotuloDaCategoria,
  textoDoUso,
  ordenarPecas,
  filtrarPecas,
  dataLocalDe,
} from '../lib/guardaRoupa.js'

// O guarda-roupa: a grade das peças, cada uma com a foto. Aqui a pessoa só
// fotografa e, se quiser, corrige; quem classifica (nome, categoria, cor,
// ocasião, temperatura) é o Claude, pelo conector, olhando a foto — por isso
// nenhum campo é obrigatório e a peça nova entra como "pendente".

// Falta a permissão dos arquivos do Drive (drive.file), a mesma dos anexos.
function semPermissao(err) {
  return err?.status === 403 && /insufficient|scope|permission/i.test(err.body || err.message || '')
}

function explicarErro(err) {
  if (err?.status === 403) return 'o Drive recusou o acesso'
  if (err?.status >= 500) return 'o Drive está fora do ar agora; tente de novo em instantes'
  if (err?.status) return `o Drive respondeu com erro ${err.status}`
  return err?.message || 'erro inesperado'
}

// Chips de filtro do MD3 para escolher mais de um valor (ocasião, temperatura).
function Escolhas({ rotulo, opcoes, valor, onChange }) {
  function alternar(id) {
    onChange(valor.includes(id) ? valor.filter((v) => v !== id) : [...valor, id])
  }
  return (
    <div className="field" role="group" aria-label={rotulo}>
      <span>{rotulo}</span>
      <div className="gr-chips">
        {opcoes.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`pill-filtro${valor.includes(o.id) ? ' is-escolhido' : ''}`}
            aria-pressed={valor.includes(o.id)}
            onClick={() => alternar(o.id)}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  )
}

function EditorDaPeca({ peca, hoje, onSalvar, onExcluir, onFechar }) {
  const [nome, setNome] = useState(peca.nome)
  const [categoria, setCategoria] = useState(peca.categoria)
  const [cor, setCor] = useState(peca.cor)
  const [ocasioes, setOcasioes] = useState(peca.ocasioes)
  const [temperaturas, setTemperaturas] = useState(peca.temperaturas)
  const [observacoes, setObservacoes] = useState(peca.observacoes)
  const [ativa, setAtiva] = useState(peca.ativa)
  const [confirmando, setConfirmando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erro, setErro] = useState(null)

  function salvar(e) {
    e.preventDefault()
    onSalvar(peca.id, { nome, categoria, cor, ocasioes, temperaturas, observacoes, ativa })
    onFechar()
  }

  async function excluir() {
    setConfirmando(false)
    setExcluindo(true)
    setErro(null)
    try {
      await onExcluir(peca.id)
      onFechar()
    } catch (err) {
      setErro(`Não deu para excluir: ${explicarErro(err)}.`)
      setExcluindo(false)
    }
  }

  return (
    <Modal title={peca.nome || 'Peça nova'} onClose={onFechar} largo>
      <form className="gr-editor" onSubmit={salvar}>
        <div className="gr-editor-foto">
          <FotoDaPeca peca={peca} />
          <p className="muted t-label">
            {textoDoUso(peca, hoje)}
            {peca.usos > 0 && ` · ${peca.usos} uso${peca.usos === 1 ? '' : 's'}`}
          </p>
        </div>

        <div className="gr-editor-campos">
          {peca.status === PENDENTE && (
            <p className="muted gr-editor-dica">
              Nada aqui é obrigatório: deixe em branco e o Claude classifica a peça pela foto na próxima rotina da manhã.
            </p>
          )}
          <label className="field">
            <span>Nome</span>
            <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Camisa de linho azul" maxLength={120} />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Categoria</span>
              <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="">Sem categoria</option>
                {CATEGORIAS.map((c) => (
                  <option key={c.id} value={c.id}>{c.rotulo}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Cor</span>
              <input type="text" value={cor} onChange={(e) => setCor(e.target.value)} maxLength={60} />
            </label>
          </div>
          <Escolhas rotulo="Ocasião" opcoes={OCASIOES} valor={ocasioes} onChange={setOcasioes} />
          <Escolhas rotulo="Temperatura" opcoes={TEMPERATURAS} valor={temperaturas} onChange={setTemperaturas} />
          <label className="field">
            <span>Observações</span>
            <textarea className="gr-observacoes" rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} maxLength={1000} />
          </label>
          <label className="gr-ativa">
            <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
            <span>
              Ativa
              <small>Desativada, a peça continua aqui mas não entra nos looks (está no conserto, guardada, fora da estação).</small>
            </span>
          </label>

          {erro && <div className="form-error">{erro}</div>}

          <div className="modal-actions">
            <button type="button" className="danger" onClick={() => setConfirmando(true)} disabled={excluindo}>Excluir</button>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={onFechar} disabled={excluindo}>Cancelar</button>
            <button type="submit" className="primary" disabled={excluindo}>Salvar</button>
          </div>
        </div>
      </form>

      {confirmando && (
        <ConfirmDialog
          title="Excluir peça"
          message={`${peca.nome ? `"${peca.nome}"` : 'Esta peça'} sai do guarda-roupa e a foto vai para a lixeira do Google Drive, de onde dá para recuperar por 30 dias. Para só tirá-la dos looks, desmarque "Ativa".`}
          confirmLabel="Excluir"
          danger
          onConfirm={excluir}
          onCancel={() => setConfirmando(false)}
        />
      )}
    </Modal>
  )
}

export default function GuardaRoupa({ guardaRoupa }) {
  const { pecas, adicionarPeca, salvarPeca, excluirPeca, syncStatus } = guardaRoupa
  const [categoria, setCategoria] = useState('')
  const [soPendentes, setSoPendentes] = useState(false)
  const [comInativas, setComInativas] = useState(false)
  const [ordem, setOrdem] = useState('recentes')
  const [editandoId, setEditandoId] = useState(null)
  const [enviando, setEnviando] = useState([])
  const [erro, setErro] = useState(null)
  const [precisaPermissao, setPrecisaPermissao] = useState(false)
  const cameraRef = useRef(null)
  const galeriaRef = useRef(null)
  const hoje = dataLocalDe(new Date())

  const pendentes = pecas.filter((p) => p.ativa && p.status === PENDENTE).length
  const inativas = pecas.filter((p) => !p.ativa).length
  const visiveis = useMemo(
    () => ordenarPecas(filtrarPecas(pecas, { categoria, status: soPendentes ? PENDENTE : '', inativas: comInativas }), ordem, hoje),
    [pecas, categoria, soPendentes, comInativas, ordem, hoje]
  )
  const editando = pecas.find((p) => p.id === editandoId)

  // Confere a permissão antes de abrir a câmera: se faltar, o pedido ao
  // Google tiraria a pessoa da tela e a foto tirada se perderia.
  function escolher(ref) {
    if (permissaoDosArquivos() === false) {
      setPrecisaPermissao(true)
      return
    }
    ref.current?.click()
  }

  async function receber(e) {
    const arquivos = [...(e.target.files || [])]
    e.target.value = ''
    if (!arquivos.length) return
    setErro(null)
    const fila = arquivos.map((arquivo, i) => ({ chave: `${Date.now()}-${i}`, arquivo, progresso: 0 }))
    setEnviando((atual) => [...atual, ...fila.map(({ chave, progresso }) => ({ chave, progresso }))])
    let ultima = null
    // Uma de cada vez: no celular, envios juntos disputam a mesma conexão.
    for (const item of fila) {
      try {
        ultima = await adicionarPeca(item.arquivo, {}, (p) =>
          setEnviando((atual) => atual.map((x) => (x.chave === item.chave ? { ...x, progresso: p } : x)))
        )
      } catch (err) {
        if (semPermissao(err)) {
          setPrecisaPermissao(true)
          setEnviando((atual) => atual.filter((x) => !fila.some((f) => f.chave === x.chave)))
          return
        }
        setErro(`Não deu para adicionar a foto: ${explicarErro(err)}.`)
      } finally {
        setEnviando((atual) => atual.filter((x) => x.chave !== item.chave))
      }
    }
    // Uma foto só: abre a peça para quem quiser já preencher. Várias de uma
    // vez é quem está fotografando o armário — entram todas como pendentes.
    if (fila.length === 1 && ultima) setEditandoId(ultima.id)
  }

  const resumo = [
    `${pecas.length} peça${pecas.length === 1 ? '' : 's'}`,
    pendentes ? `${pendentes} aguardando classificação` : null,
    descreverSincronizacao(syncStatus),
  ].filter(Boolean)

  return (
    <div className="guarda-roupa">
      <div className="gr-topo">
        <div className="gr-adicionar">
          <button type="button" className="primary" onClick={() => escolher(cameraRef)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            Tirar foto
          </button>
          <button type="button" onClick={() => escolher(galeriaRef)}>Escolher da galeria</button>
          {/* `capture` abre a câmera direto no celular; no computador o
              navegador ignora e mostra o seletor de arquivos. */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={receber} />
          <input ref={galeriaRef} type="file" accept="image/*" multiple hidden onChange={receber} />
        </div>
        {pecas.length > 0 && <p className="muted gr-resumo">{resumo.join(' · ')}</p>}
      </div>

      {precisaPermissao && (
        <Banner tone="info" actionLabel="Permitir" onAction={pedirAcessoAosArquivos}>
          Para guardar as fotos na pasta "Guarda-roupa" do seu Drive, o app precisa da permissão de criar arquivos lá. Ele só enxerga o que ele mesmo criou.
        </Banner>
      )}
      {erro && (
        <Banner tone="error" actionLabel="Entendi" onAction={() => setErro(null)}>
          {erro}
        </Banner>
      )}
      {guardaRoupa.error && (
        <Banner tone="warning" actionLabel="Entendi" onAction={guardaRoupa.dismissError}>
          {guardaRoupa.error}
        </Banner>
      )}

      {pecas.length > 0 && (
        <div className="gr-filtros">
          <div className="gr-chips" role="group" aria-label="Filtrar por categoria">
            <button type="button" className={`pill-filtro${!categoria ? ' is-escolhido' : ''}`} aria-pressed={!categoria} onClick={() => setCategoria('')}>
              Todas
            </button>
            {CATEGORIAS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`pill-filtro${categoria === c.id ? ' is-escolhido' : ''}`}
                aria-pressed={categoria === c.id}
                onClick={() => setCategoria(categoria === c.id ? '' : c.id)}
              >
                {c.rotulo}
              </button>
            ))}
            {pendentes > 0 && (
              <button type="button" className={`pill-filtro${soPendentes ? ' is-escolhido' : ''}`} aria-pressed={soPendentes} onClick={() => setSoPendentes(!soPendentes)}>
                Pendentes ({pendentes})
              </button>
            )}
            {inativas > 0 && (
              <button type="button" className={`pill-filtro${comInativas ? ' is-escolhido' : ''}`} aria-pressed={comInativas} onClick={() => setComInativas(!comInativas)}>
                Mostrar desativadas ({inativas})
              </button>
            )}
          </div>
          <label className="field gr-ordem">
            <span>Ordenar por</span>
            <select value={ordem} onChange={(e) => setOrdem(e.target.value)}>
              {ORDENS.map((o) => (
                <option key={o.id} value={o.id}>{o.rotulo}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {pecas.length === 0 && enviando.length === 0 ? (
        <div className="gr-vazio">
          <p className="t-title">Seu guarda-roupa está vazio</p>
          <p className="muted">
            Fotografe cada peça, uma por foto. Não precisa preencher nada: o Claude olha a foto, classifica e passa a sugerir o look do dia na tela inicial.
          </p>
        </div>
      ) : (
        <ul className="gr-grade">
          {enviando.map((x) => (
            <li key={x.chave} className="gr-peca is-enviando" aria-live="polite">
              <div className="gr-foto is-vazia" />
              <div className="gr-peca-texto">
                <span className="gr-peca-nome">Enviando… {Math.round(x.progresso * 100)}%</span>
                <progress value={x.progresso} max={1} />
              </div>
            </li>
          ))}
          {visiveis.map((p) => (
            <li key={p.id} className={`gr-peca clicavel${p.ativa ? '' : ' is-inativa'}`} onClick={() => setEditandoId(p.id)}>
              <FotoDaPeca peca={p} />
              <div className="gr-peca-texto">
                <button type="button" className="titulo-botao gr-peca-nome" onClick={(e) => { e.stopPropagation(); setEditandoId(p.id) }}>
                  {p.nome || 'Sem nome'}
                </button>
                <span className="gr-peca-meta">
                  {[rotuloDaCategoria(p.categoria), p.cor].filter(Boolean).join(' · ') || 'Sem classificação'}
                </span>
                <span className="gr-peca-meta">{textoDoUso(p, hoje)}</span>
                {(p.status === PENDENTE || !p.ativa) && (
                  <span className="gr-peca-marcas">
                    {p.status === PENDENTE && <span className="pill gr-marca">Pendente</span>}
                    {!p.ativa && <span className="pill gr-marca">Desativada</span>}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {pecas.length > 0 && visiveis.length === 0 && enviando.length === 0 && (
        <p className="muted gr-sem-resultado">Nenhuma peça com esse filtro.</p>
      )}

      {editando && (
        <EditorDaPeca
          key={editando.id}
          peca={editando}
          hoje={hoje}
          onSalvar={salvarPeca}
          onExcluir={excluirPeca}
          onFechar={() => setEditandoId(null)}
        />
      )}
    </div>
  )
}
