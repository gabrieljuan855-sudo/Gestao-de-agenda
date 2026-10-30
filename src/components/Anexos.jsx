import { useEffect, useRef, useState } from 'react'
import Banner from './Banner.jsx'
import Modal from './Modal.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { criarArquivoGoogle, enviarArquivoAoDrive, baixarDoDrive, renomearArquivo, mandarParaLixeira } from '../lib/googleApi.js'
import { permissaoDosArquivos, pedirAcessoAosArquivos } from '../lib/googleAuth.js'
import { tipoDoArquivo, vincularArquivo, arquivoDoDrive, juntarArquivos, tamanhoLegivel, NOVOS_ARQUIVOS } from '../lib/projetos.js'
import {
  separarArquivos,
  mensagemDeRecusa,
  nomeDoColado,
  nomeAoRenomear,
  tipoDePrevia,
  podeBaixar,
  ACEITOS_NO_SELETOR,
} from '../lib/arquivosValidacao.js'

// Os arquivos de um projeto, de uma tarefa ou de uma nota — o mesmo
// componente nos três lugares, porque o gesto é o mesmo: arrastar, colar ou
// escolher, e o arquivo vai para a pasta do projeto no Drive. Quem usa diz
// onde fica a pasta (garantirPasta) e o que fazer com a lista nova
// (onMudar); daqui para dentro não importa de quem são os arquivos.

// Ícone por tipo, para achar "a planilha" ou "o PDF" de olho numa lista longa.
const ICONE_DO_TIPO = {
  doc: 'M6 3h9l5 5v13H6zM14 3v6h6M9 13h8M9 17h6',
  planilha: 'M5 4h14v16H5zM5 10h14M5 15h14M10 4v16',
  apresentacao: 'M4 5h16v11H4zM12 16v4M8 20h8',
  formulario: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4',
  pasta: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  pdf: 'M6 3h9l5 5v13H6zM14 3v6h6M9 15h6',
  drive: 'M6 3h9l5 5v13H6zM14 3v6h6',
  imagem: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1.5 1.5 0 1 0 0-.01',
  audio: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  video: 'M4 6h12v12H4zM16 10l4-2v8l-4-2',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
}

export function IconeDoArquivo({ arquivo, tamanho = 18 }) {
  const { tipo } = tipoDoArquivo(arquivo)
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONE_DO_TIPO[tipo] || ICONE_DO_TIPO.drive} />
    </svg>
  )
}

// Falta a permissão nova (drive.file), ou o Google disse que ela não veio.
const SEM_PERMISSAO = 'sem-permissao'
function semPermissao(err) {
  return err?.status === 403 && /insufficient|scope|permission/i.test(err.body || err.message || '')
}

// Sem o corpo da resposta do Google na tela: ele repete o nome do arquivo e
// às vezes o caminho — e o nome de um arquivo de caso é dado de pessoa.
function explicarErro(err) {
  if (err?.status === 404) return 'o arquivo não existe mais no Drive'
  if (err?.status === 403) return 'o Drive recusou (o arquivo pode não ter sido criado pelo app)'
  if (err?.status >= 500) return 'o Drive está fora do ar agora; tente de novo em instantes'
  if (/conexão|network|fetch/i.test(err?.message || '')) return 'sem conexão'
  return 'erro inesperado do Drive'
}

function baixarComoArquivo(blob, nome) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

// Diálogo do arquivo aberto: a prévia (PDF e imagem), e o que se faz com
// ele — abrir no Drive, baixar, renomear, remover. Tela cheia no celular,
// que é o que o MD3 pede para conteúdo que precisa de espaço.
function ArquivoAberto({ arquivo, onFechar, onRenomear, onRemover }) {
  const previa = tipoDePrevia(arquivo)
  const [conteudo, setConteudo] = useState(null)
  const [carregando, setCarregando] = useState(Boolean(previa))
  const [erro, setErro] = useState(null)
  const [renomeando, setRenomeando] = useState(false)
  const [nome, setNome] = useState(arquivo.nome)
  const [ocupado, setOcupado] = useState(false)
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false)
  const { rotulo } = tipoDoArquivo(arquivo)

  useEffect(() => {
    if (!previa) return undefined
    let vivo = true
    let url = null
    baixarDoDrive(arquivo.driveId)
      .then((blob) => {
        if (!vivo) return
        url = URL.createObjectURL(blob)
        setConteudo(url)
      })
      .catch((err) => vivo && setErro(`Não deu para mostrar a prévia: ${explicarErro(err)}.`))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [arquivo.driveId, previa])

  async function baixar() {
    setOcupado(true)
    setErro(null)
    try {
      baixarComoArquivo(await baixarDoDrive(arquivo.driveId), arquivo.nome)
    } catch (err) {
      setErro(`Não deu para baixar: ${explicarErro(err)}.`)
    } finally {
      setOcupado(false)
    }
  }

  async function renomear(e) {
    e.preventDefault()
    const novo = nomeAoRenomear(nome, arquivo.nome)
    if (!novo || novo === arquivo.nome) {
      setRenomeando(false)
      return
    }
    setOcupado(true)
    setErro(null)
    try {
      await onRenomear(arquivo, novo)
      setRenomeando(false)
    } catch (err) {
      setErro(`Não deu para renomear: ${explicarErro(err)}.`)
    } finally {
      setOcupado(false)
    }
  }

  async function remover() {
    setConfirmandoRemocao(false)
    setOcupado(true)
    setErro(null)
    try {
      await onRemover(arquivo)
      onFechar()
    } catch (err) {
      setErro(`Não deu para remover: ${explicarErro(err)}.`)
      setOcupado(false)
    }
  }

  const detalhe = [rotulo, Number.isFinite(arquivo.tamanho) && tamanhoLegivel(arquivo.tamanho)].filter(Boolean).join(' · ')

  return (
    <Modal title={arquivo.nome} onClose={onFechar} largo>
      <div className="arquivo-aberto">
        <div className={`arquivo-aberto-previa${previa ? '' : ' is-sem-previa'}`}>
          {carregando && <p className="muted">Carregando a prévia…</p>}
          {conteudo && previa === 'imagem' && <img src={conteudo} alt={arquivo.nome} />}
          {conteudo && previa === 'pdf' && <iframe src={conteudo} title={arquivo.nome} />}
          {!previa && (
            <div className="arquivo-aberto-sem-previa">
              <IconeDoArquivo arquivo={arquivo} tamanho={40} />
              <p className="muted">{arquivo.driveId ? 'A prévia aqui dentro é para PDF e imagem. Este abre no Drive.' : 'Este é um link: abre no lugar de onde ele vem.'}</p>
            </div>
          )}
        </div>

        <div className="arquivo-aberto-info muted t-label">{detalhe}</div>

        {renomeando ? (
          <form className="projeto-arquivo-novo" onSubmit={renomear}>
            <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Novo nome" autoFocus />
            <button type="button" onClick={() => setRenomeando(false)}>Cancelar</button>
            <button type="submit" className="primary" disabled={ocupado || !nome.trim()}>Salvar</button>
          </form>
        ) : (
          <div className="arquivo-aberto-acoes">
            <a className="arquivo-acao is-principal" href={arquivo.url} target="_blank" rel="noopener noreferrer">
              {arquivo.driveId ? 'Abrir no Drive' : 'Abrir o link'}
            </a>
            {podeBaixar(arquivo) && (
              <button type="button" className="arquivo-acao" onClick={baixar} disabled={ocupado}>Baixar</button>
            )}
            <button type="button" className="arquivo-acao" onClick={() => setRenomeando(true)} disabled={ocupado}>Renomear</button>
            <button type="button" className="arquivo-acao is-perigo" onClick={() => setConfirmandoRemocao(true)} disabled={ocupado}>Remover</button>
          </div>
        )}
        {erro && <div className="form-error">{erro}</div>}
      </div>

      {confirmandoRemocao && (
        <ConfirmDialog
          title="Remover arquivo"
          message={
            arquivo.driveId
              ? `"${arquivo.nome}" vai para a lixeira do Google Drive, de onde dá para recuperar por 30 dias.`
              : `O link "${arquivo.nome}" sai daqui. O arquivo em si, onde ele estiver, não é apagado.`
          }
          confirmLabel={arquivo.driveId ? 'Mandar para a lixeira' : 'Remover o link'}
          danger
          onConfirm={remover}
          onCancel={() => setConfirmandoRemocao(false)}
        />
      )}
    </Modal>
  )
}

export default function Anexos({
  arquivos = [],
  onMudar,
  garantirPasta,
  nomeDoNovoPadrao = '',
  permitirCriar = true,
  pastaUrl = null,
  dica = 'Arraste arquivos para cá, cole (Ctrl+V) ou use os botões abaixo. Eles vão para a pasta do projeto no seu Drive.',
}) {
  const [link, setLink] = useState('')
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState(null)
  const [vinculando, setVinculando] = useState(false)
  const [criando, setCriando] = useState(null)
  const [nomeDoNovo, setNomeDoNovo] = useState('')
  const [enviando, setEnviando] = useState([])
  const [arrastando, setArrastando] = useState(false)
  const [precisaPermissao, setPrecisaPermissao] = useState(false)
  const [abertoId, setAbertoId] = useState(null)
  const escolherRef = useRef(null)
  // A lista mais recente, lida depois de cada envio: vários arquivos sobem um
  // atrás do outro, e a lista de quando o primeiro começou já está velha.
  const arquivosRef = useRef(arquivos)
  arquivosRef.current = arquivos
  const aberto = arquivos.find((a) => a.id === abertoId)

  function mudar(nova) {
    arquivosRef.current = nova
    onMudar(nova)
  }

  // Confere a permissão antes de abrir o seletor: se faltar, o login novo
  // tiraria a pessoa da tela e os arquivos escolhidos se perderiam.
  function podeUsarODrive() {
    if (permissaoDosArquivos() === false) {
      setPrecisaPermissao(true)
      return false
    }
    return true
  }

  function tratarErro(err, oQue) {
    if (semPermissao(err)) {
      setPrecisaPermissao(true)
      return SEM_PERMISSAO
    }
    setErro(`Não deu para ${oQue}: ${explicarErro(err)}.`)
    return null
  }

  async function enviar(lista) {
    const { validos, recusados } = separarArquivos([...(lista || [])])
    setErro(mensagemDeRecusa(recusados))
    if (!validos.length || !podeUsarODrive()) return
    const fila = validos.map((f, i) => ({ chave: `${Date.now()}-${i}`, nome: f.name, progresso: 0, arquivo: f }))
    setEnviando((atual) => [...atual, ...fila.map(({ arquivo, ...resto }) => resto)])
    let pasta
    try {
      pasta = await garantirPasta()
    } catch (err) {
      tratarErro(err, 'abrir a pasta do projeto no Drive')
      setEnviando((atual) => atual.filter((e) => !fila.some((f) => f.chave === e.chave)))
      return
    }
    // Um de cada vez: no celular, vários envios juntos disputam a mesma
    // conexão e todos ficam lentos.
    for (const item of fila) {
      try {
        const doDrive = await enviarArquivoAoDrive(pasta.id, item.arquivo, (p) =>
          setEnviando((atual) => atual.map((e) => (e.chave === item.chave ? { ...e, progresso: p } : e)))
        )
        mudar(juntarArquivos(arquivosRef.current, [arquivoDoDrive(doDrive)]))
      } catch (err) {
        if (tratarErro(err, `enviar "${item.nome}"`) === SEM_PERMISSAO) break
      } finally {
        setEnviando((atual) => atual.filter((e) => e.chave !== item.chave))
      }
    }
  }

  // Colar um arquivo ou um print (Ctrl+V / ⌘V) enquanto os anexos estão na
  // tela. Texto colado num campo segue o caminho normal: só arquivo é nosso.
  const enviarRef = useRef(enviar)
  enviarRef.current = enviar
  useEffect(() => {
    function aoColar(e) {
      const itens = [...(e.clipboardData?.files || [])]
      if (!itens.length) return
      e.preventDefault()
      const agora = new Date()
      const comNome = itens.map((f) => {
        const novo = nomeDoColado(f.name, f.type, agora)
        return novo === f.name ? f : new File([f], novo, { type: f.type })
      })
      enviarRef.current(comNome)
    }
    window.addEventListener('paste', aoColar)
    return () => window.removeEventListener('paste', aoColar)
  }, [])

  async function criar(e) {
    e.preventDefault()
    const escolhido = NOVOS_ARQUIVOS.find((n) => n.tipo === criando)
    if (!escolhido || !podeUsarODrive()) return
    const titulo = nomeDoNovo.trim() || `${escolhido.rotulo} — ${nomeDoNovoPadrao}`
    setErro(null)
    // A aba é aberta já, no toque: aberta depois da espera pelo Drive, o
    // navegador a trataria como pop-up e bloquearia.
    const aba = window.open('', '_blank')
    try {
      const pasta = await garantirPasta()
      const doDrive = await criarArquivoGoogle(pasta.id, titulo, escolhido.mime)
      mudar(juntarArquivos(arquivosRef.current, [arquivoDoDrive(doDrive)]))
      if (aba) aba.location.href = doDrive.webViewLink
      setCriando(null)
      setNomeDoNovo('')
    } catch (err) {
      aba?.close()
      tratarErro(err, `criar ${escolhido.rotulo.toLowerCase()}`)
    }
  }

  function vincular(e) {
    e.preventDefault()
    const nova = vincularArquivo(arquivos, { url: link, nome })
    if (!nova) {
      setErro('Isso não parece um link. Cole o endereço do arquivo (ex.: o "Copiar link" do Drive).')
      return
    }
    mudar(nova)
    setLink('')
    setNome('')
    setErro(null)
    setVinculando(false)
  }

  async function renomear(arquivo, novo) {
    // Arquivo do Drive muda de nome lá também; link só muda aqui.
    if (arquivo.driveId) await renomearArquivo(arquivo.driveId, novo)
    mudar(arquivosRef.current.map((a) => (a.id === arquivo.id ? { ...a, nome: novo } : a)))
  }

  async function remover(arquivo) {
    if (arquivo.driveId) {
      try {
        await mandarParaLixeira(arquivo.driveId)
      } catch (err) {
        // Já não existe no Drive (apagado por fora): só falta sair daqui.
        if (err?.status !== 404) throw err
      }
    }
    mudar(arquivosRef.current.filter((a) => a.id !== arquivo.id))
  }

  // Arrastar do computador: a área inteira vira o lugar de soltar.
  const arrastar = {
    onDragOver: (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return
      e.preventDefault()
      setArrastando(true)
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setArrastando(false)
    },
    onDrop: (e) => {
      if (!e.dataTransfer?.files?.length) return
      e.preventDefault()
      setArrastando(false)
      enviar(e.dataTransfer.files)
    },
  }

  return (
    <div className={`projeto-arquivos${arrastando ? ' is-arrastando' : ''}`} {...arrastar}>
      {precisaPermissao && (
        <Banner tone="info" actionLabel="Permitir" onAction={pedirAcessoAosArquivos}>
          Para enviar e criar arquivos, o Segundo Cérebro precisa de uma permissão nova do Google: acesso aos arquivos que ele
          mesmo criar no seu Drive (o resto do Drive continua fora de alcance). Depois de permitir, envie de novo.
        </Banner>
      )}

      {arquivos.map((a) => {
        const { rotulo } = tipoDoArquivo(a)
        const detalhe = [rotulo, Number.isFinite(a.tamanho) && tamanhoLegivel(a.tamanho)].filter(Boolean).join(' · ')
        return (
          <button key={a.id} type="button" className="projeto-arquivo projeto-arquivo-link" onClick={() => setAbertoId(a.id)}>
            <IconeDoArquivo arquivo={a} />
            <span className="projeto-arquivo-texto">
              <span className="projeto-arquivo-nome">{a.nome}</span>
              <span className="projeto-evento-quando">{detalhe}</span>
            </span>
          </button>
        )
      })}

      {/* Indicador de progresso linear do MD3, um por arquivo subindo. */}
      {enviando.map((e) => (
        <div key={e.chave} className="projeto-envio" role="status">
          <span className="projeto-arquivo-nome">{e.nome}</span>
          <span className="projeto-envio-barra" aria-hidden="true">
            <span style={{ width: `${Math.round(e.progresso * 100)}%` }} />
          </span>
          <span className="projeto-evento-quando">{e.progresso >= 1 ? 'Concluindo…' : `Enviando… ${Math.round(e.progresso * 100)}%`}</span>
        </div>
      ))}

      {arquivos.length === 0 && enviando.length === 0 && <p className="muted projeto-vazio projeto-arquivos-dica">{dica}</p>}

      <input
        ref={escolherRef}
        type="file"
        multiple
        hidden
        accept={ACEITOS_NO_SELETOR}
        onChange={(e) => {
          enviar(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="projeto-arquivos-acoes">
        <button type="button" onClick={() => podeUsarODrive() && escolherRef.current?.click()}>
          Anexar arquivos
        </button>
        {permitirCriar && (
          <button
            type="button"
            className={criando ? 'is-escolhido' : ''}
            aria-expanded={Boolean(criando)}
            onClick={() => {
              setCriando((atual) => (atual ? null : NOVOS_ARQUIVOS[0].tipo))
              setNomeDoNovo('')
            }}
          >
            + Criar
          </button>
        )}
      </div>

      {criando && (
        <form className="projeto-arquivo-criar" onSubmit={criar}>
          {/* Chips de escolha: um tipo entre três, como no MD3. */}
          <div className="projeto-arquivo-tipos" role="radiogroup" aria-label="Tipo do arquivo novo">
            {NOVOS_ARQUIVOS.map((n) => (
              <button
                key={n.tipo}
                type="button"
                role="radio"
                aria-checked={criando === n.tipo}
                className={`pill pill-filtro${criando === n.tipo ? ' is-escolhido' : ''}`}
                onClick={() => setCriando(n.tipo)}
              >
                {n.rotulo}
              </button>
            ))}
          </div>
          <div className="projeto-arquivo-novo">
            <input
              type="text"
              value={nomeDoNovo}
              onChange={(e) => setNomeDoNovo(e.target.value)}
              placeholder={`${NOVOS_ARQUIVOS.find((n) => n.tipo === criando).rotulo} — ${nomeDoNovoPadrao}`}
              aria-label="Nome do arquivo novo"
              autoFocus
            />
            <button type="submit" className="primary">Criar e abrir</button>
          </div>
        </form>
      )}

      {vinculando ? (
        <form className="projeto-arquivo-novo" onSubmit={vincular}>
          <input type="text" value={link} onChange={(e) => { setLink(e.target.value); setErro(null) }} placeholder="Cole o link (Drive, PDF, site)" autoFocus />
          <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome (opcional)" />
          <button type="submit" disabled={!link.trim()}>Vincular</button>
        </form>
      ) : (
        <div className="projeto-arquivos-rodape">
          <button type="button" className="link-btn projeto-mais" onClick={() => setVinculando(true)}>Vincular um link</button>
          {pastaUrl && (
            <a className="link-btn projeto-mais" href={pastaUrl} target="_blank" rel="noopener noreferrer">
              Abrir a pasta no Drive
            </a>
          )}
        </div>
      )}
      {erro && <div className="form-error" role="alert">{erro}</div>}

      {aberto && <ArquivoAberto arquivo={aberto} onFechar={() => setAbertoId(null)} onRenomear={renomear} onRemover={remover} />}
    </div>
  )
}
