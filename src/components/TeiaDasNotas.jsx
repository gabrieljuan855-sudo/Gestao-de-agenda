import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { montarTeia, vizinhosNaTeia, criarSimulacao, passoDaTeia, caixaDaTeia } from '../lib/teia.js'

// A teia de ligações das anotações, como o grafo do Obsidian. O cálculo
// (quem liga com quem, onde cada ponto fica) mora em lib/teia.js; aqui fica
// o desenho e o manuseio: arrastar para mover a vista, pinça ou roda para
// aproximar, arrastar um ponto para puxá-lo, tocar para ver a vizinhança.

const ESCALA_MIN = 0.2
const ESCALA_MAX = 4
// Quanto um toque pode escorregar e ainda ser toque (e não arrasto).
const FOLGA_DO_TOQUE = 6
// Tempo de simulação por quadro: o resto do quadro fica para o desenho, e a
// tela não engasga nem com uma base grande num celular.
const ORCAMENTO_DO_QUADRO_MS = 10

function raioDe(no) {
  return no.tipo === 'projeto' ? 9 + Math.min(Math.sqrt(no.grau) * 2, 10) : 4 + Math.min(Math.sqrt(no.grau) * 2, 9)
}

function encurtar(texto, max = 28) {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto
}

export default function TeiaDasNotas({ notas, projetos = [], focoInicial = null, onAbrirNota, onAbrirProjeto }) {
  const [comProjetos, setComProjetos] = useState(true)
  const [comSoltas, setComSoltas] = useState(true)
  const [selecionado, setSelecionado] = useState(focoInicial)
  const [, setQuadro] = useState(0)
  const [tamanho, setTamanho] = useState({ largura: 0, altura: 0 })
  // A câmera: o ponto do mundo no centro da tela e quantos pixels vale uma
  // unidade do mundo.
  const [camera, setCamera] = useState({ cx: 0, cy: 0, escala: 1 })
  const svgRef = useRef(null)
  const simRef = useRef(null)
  const rodandoRef = useRef(false)
  // Enquanto a pessoa não mexeu na vista, ela acompanha a teia se abrindo.
  const mexeuRef = useRef(false)
  const ponteirosRef = useRef(new Map())
  const gestoRef = useRef(null)
  const tamanhoRef = useRef(tamanho)
  tamanhoRef.current = tamanho

  const teia = useMemo(() => montarTeia(notas, projetos, { comProjetos, comSoltas }), [notas, projetos, comProjetos, comSoltas])

  useLayoutEffect(() => {
    const el = svgRef.current
    if (!el) return
    const medir = () => setTamanho({ largura: el.clientWidth, altura: el.clientHeight })
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    return () => observador.disconnect()
  }, [])

  function enquadrar() {
    const sim = simRef.current
    const { largura, altura } = tamanhoRef.current
    if (!sim || !largura || !altura) return
    // Margem larga: os rótulos passam das bolinhas, e não podem cortar na borda.
    const caixa = caixaDaTeia(sim.nos, 70)
    const escala = Math.min(Math.max(Math.min(largura / caixa.largura, altura / caixa.altura), ESCALA_MIN), 1.6)
    setCamera({ cx: caixa.x + caixa.largura / 2, cy: caixa.y + caixa.altura / 2, escala })
  }

  function animar() {
    if (rodandoRef.current) return
    rodandoRef.current = true
    const quadro = () => {
      const sim = simRef.current
      if (!sim) {
        rodandoRef.current = false
        return
      }
      const inicio = performance.now()
      let continuar = true
      while (continuar && performance.now() - inicio < ORCAMENTO_DO_QUADRO_MS) continuar = passoDaTeia(sim)
      if (!mexeuRef.current) enquadrar()
      setQuadro((q) => q + 1)
      if (continuar || gestoRef.current?.tipo === 'ponto') requestAnimationFrame(quadro)
      else rodandoRef.current = false
    }
    requestAnimationFrame(quadro)
  }

  // Teia nova (nota nova, filtro trocado): quem já estava na tela fica onde
  // estava, e só o que mudou se acomoda.
  useEffect(() => {
    const anteriores = new Map((simRef.current?.nos || []).map((n) => [n.id, { x: n.x, y: n.y }]))
    simRef.current = criarSimulacao(teia, { anteriores })
    animar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teia])

  useEffect(() => () => (simRef.current = null), [])

  // ---- da tela para o mundo ----
  function noMundo(clienteX, clienteY) {
    const caixa = svgRef.current.getBoundingClientRect()
    return {
      x: camera.cx + (clienteX - caixa.left - caixa.width / 2) / camera.escala,
      y: camera.cy + (clienteY - caixa.top - caixa.height / 2) / camera.escala,
    }
  }

  function aproximar(fator, clienteX, clienteY) {
    mexeuRef.current = true
    setCamera((c) => {
      const escala = Math.min(Math.max(c.escala * fator, ESCALA_MIN), ESCALA_MAX)
      const caixa = svgRef.current.getBoundingClientRect()
      // O ponto debaixo do dedo (ou do cursor) continua debaixo dele.
      const ox = clienteX - caixa.left - caixa.width / 2
      const oy = clienteY - caixa.top - caixa.height / 2
      const mx = c.cx + ox / c.escala
      const my = c.cy + oy / c.escala
      return { cx: mx - ox / escala, cy: my - oy / escala, escala }
    })
  }

  function aoApertar(e) {
    svgRef.current.setPointerCapture(e.pointerId)
    ponteirosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ponteirosRef.current.size === 2) {
      const [a, b] = [...ponteirosRef.current.values()]
      gestoRef.current = { tipo: 'pinca', distancia: Math.hypot(a.x - b.x, a.y - b.y) }
      return
    }
    const id = e.target.closest('[data-id]')?.getAttribute('data-id')
    gestoRef.current = { tipo: id ? 'ponto' : 'vista', id, x0: e.clientX, y0: e.clientY, ultimo: { x: e.clientX, y: e.clientY }, moveu: false }
  }

  function aoMover(e) {
    if (!ponteirosRef.current.has(e.pointerId)) return
    ponteirosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const gesto = gestoRef.current
    if (!gesto) return
    if (gesto.tipo === 'pinca' && ponteirosRef.current.size === 2) {
      const [a, b] = [...ponteirosRef.current.values()]
      const distancia = Math.hypot(a.x - b.x, a.y - b.y)
      if (gesto.distancia > 0) aproximar(distancia / gesto.distancia, (a.x + b.x) / 2, (a.y + b.y) / 2)
      gesto.distancia = distancia
      return
    }
    if (!gesto.moveu && Math.hypot(e.clientX - gesto.x0, e.clientY - gesto.y0) < FOLGA_DO_TOQUE) return
    gesto.moveu = true
    if (gesto.tipo === 'ponto') {
      const no = simRef.current?.nos.find((n) => n.id === gesto.id)
      if (!no) return
      const p = noMundo(e.clientX, e.clientY)
      no.x = p.x
      no.y = p.y
      no.fixo = true
      // Puxar um ponto reaquece a teia, para os vizinhos virem junto.
      simRef.current.alpha = Math.max(simRef.current.alpha, 0.3)
      mexeuRef.current = true
      animar()
      return
    }
    mexeuRef.current = true
    const dx = e.clientX - gesto.ultimo.x
    const dy = e.clientY - gesto.ultimo.y
    gesto.ultimo = { x: e.clientX, y: e.clientY }
    setCamera((c) => ({ ...c, cx: c.cx - dx / c.escala, cy: c.cy - dy / c.escala }))
  }

  function aoSoltar(e) {
    ponteirosRef.current.delete(e.pointerId)
    const gesto = gestoRef.current
    if (!gesto) return
    if (gesto.tipo === 'pinca') {
      // Sobrou um dedo: não vira toque nem arrasto até ele sair também.
      if (ponteirosRef.current.size === 0) gestoRef.current = null
      return
    }
    if (gesto.tipo === 'ponto') {
      const no = simRef.current?.nos.find((n) => n.id === gesto.id)
      if (no) no.fixo = false
      if (!gesto.moveu) setSelecionado(gesto.id)
    } else if (!gesto.moveu) {
      setSelecionado(null)
    }
    gestoRef.current = null
  }

  function aoRolar(e) {
    e.preventDefault()
    aproximar(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)
  }

  // A roda precisa de preventDefault, e o onWheel do React é passivo. O
  // ouvinte é um só; a ref leva a ele a versão atual da função.
  const aoRolarRef = useRef(aoRolar)
  aoRolarRef.current = aoRolar
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ouvinte = (e) => aoRolarRef.current(e)
    el.addEventListener('wheel', ouvinte, { passive: false })
    return () => el.removeEventListener('wheel', ouvinte)
  }, [])

  const sim = simRef.current
  const nos = sim?.nos || []
  const arestas = sim?.arestas || []
  const vizinhos = useMemo(() => (selecionado ? vizinhosNaTeia(teia, selecionado) : null), [teia, selecionado])
  const escolhido = nos.find((n) => n.id === selecionado) || null

  // Rótulos como no Obsidian: de longe, só os centros (os de mais ligações)
  // e a vizinhança de quem foi tocado; aproximando, todos. Numa tela de
  // celular, todos os nomes de uma vez viram um borrão de texto.
  const limiarDoRotulo = useMemo(() => {
    const graus = teia.nos.map((n) => n.grau).sort((a, b) => b - a)
    return Math.max(graus[Math.min(7, graus.length - 1)] ?? 1, 1)
  }, [teia])
  const todosOsRotulos = camera.escala >= 1.3 || (teia.nos.length <= 30 && camera.escala >= 0.95)

  const { largura, altura } = tamanho
  const viewBox = largura
    ? `${camera.cx - largura / 2 / camera.escala} ${camera.cy - altura / 2 / camera.escala} ${largura / camera.escala} ${altura / camera.escala}`
    : '-200 -200 400 400'
  const fonte = 12 / camera.escala

  return (
    <div className="teia">
      <div className="teia-filtros">
        <button
          type="button"
          className={`pill pill-filtro${comProjetos ? ' is-escolhido' : ''}`}
          aria-pressed={comProjetos}
          onClick={() => setComProjetos((v) => !v)}
        >
          {comProjetos && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="5 12 10 17 19 7" />
            </svg>
          )}
          Projetos
        </button>
        <button
          type="button"
          className={`pill pill-filtro${comSoltas ? ' is-escolhido' : ''}`}
          aria-pressed={comSoltas}
          onClick={() => setComSoltas((v) => !v)}
        >
          {comSoltas && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="5 12 10 17 19 7" />
            </svg>
          )}
          Notas soltas
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="icon-btn"
          aria-label="Enquadrar a teia"
          title="Enquadrar a teia"
          onClick={() => {
            mexeuRef.current = false
            enquadrar()
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
          </svg>
        </button>
      </div>

      <svg
        ref={svgRef}
        className="teia-tela"
        viewBox={viewBox}
        onPointerDown={aoApertar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        role="img"
        aria-label={`Teia com ${teia.nos.length} pontos e ${teia.arestas.length} ligações`}
      >
        <g>
          {arestas.map((a) => {
            const acesa = selecionado && (a.de === selecionado || a.para === selecionado)
            return (
              <line
                key={`${a.de}|${a.para}`}
                x1={nos[a.i].x}
                y1={nos[a.i].y}
                x2={nos[a.j].x}
                y2={nos[a.j].y}
                className={`teia-linha${a.tipo === 'projeto' ? ' is-projeto' : ''}${acesa ? ' is-acesa' : ''}${selecionado && !acesa ? ' is-apagada' : ''}`}
              />
            )
          })}
        </g>
        <g>
          {nos.map((n) => {
            const ehEscolhido = n.id === selecionado
            const vizinho = vizinhos?.has(n.id)
            const apagado = selecionado && !ehEscolhido && !vizinho
            // Projeto sempre com nome: são poucos e são eles que orientam.
            const rotulo = ehEscolhido || vizinho || todosOsRotulos || n.tipo === 'projeto' || n.grau >= limiarDoRotulo
            const r = raioDe(n)
            return (
              <g
                key={n.id}
                data-id={n.id}
                transform={`translate(${n.x} ${n.y})`}
                className={`teia-ponto is-${n.tipo}${n.grau === 0 ? ' is-solta' : ''}${ehEscolhido ? ' is-escolhido' : ''}${apagado ? ' is-apagado' : ''}`}
              >
                {/* Área de toque maior que o desenho: ponto de 4px não se
                    acerta com o dedo. */}
                <circle r={Math.max(r, 14 / camera.escala)} className="teia-alvo" />
                {n.tipo === 'projeto' ? <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={r * 0.35} /> : <circle r={r} />}
                {rotulo && (
                  <text y={r + fonte * 1.1} fontSize={fonte}>
                    {encurtar(n.titulo)}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {teia.nos.length === 0 && (
        <p className="muted teia-vazia">
          {notas.length ? 'Nenhuma ligação ainda. Use [[Nome da nota]] no texto para ligar uma anotação à outra.' : 'Nenhuma anotação ainda.'}
        </p>
      )}

      {escolhido && (
        <div className="teia-cartao">
          <div className="teia-cartao-texto">
            <strong>{escolhido.titulo}</strong>
            <span className="muted">
              {escolhido.tipo === 'projeto'
                ? `Projeto · ${escolhido.grau} anotaç${escolhido.grau === 1 ? 'ão' : 'ões'}`
                : escolhido.grau === 0
                  ? 'Anotação solta, sem ligações'
                  : `Anotação · ${escolhido.grau} ligaç${escolhido.grau === 1 ? 'ão' : 'ões'}`}
            </span>
          </div>
          {escolhido.tipo === 'nota' && (
            <button type="button" className="primary" onClick={() => onAbrirNota(escolhido.id)}>
              Abrir
            </button>
          )}
          {escolhido.tipo === 'projeto' && onAbrirProjeto && (
            <button type="button" className="primary" onClick={() => onAbrirProjeto(escolhido.projetoId)}>
              Abrir projeto
            </button>
          )}
        </div>
      )}
    </div>
  )
}
