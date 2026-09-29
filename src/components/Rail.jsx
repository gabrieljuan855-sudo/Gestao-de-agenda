import { useEffect, useRef } from 'react'

// O trilho: as ferramentas que se usam de vez em quando (criar, buscar,
// anotar, abrir um projeto). No computador é a barra de navegação do MD3,
// colada na borda esquerda com ícone e nome; no celular vira a barra
// flutuante de ícones no rodapé (ver CSS).
//
// Dois tipos de painel: o das ferramentas rápidas (Criar, Buscar) abre como
// um cartão ao lado da barra; o largo (Anotações, Projetos) é uma tela
// sobreposta, com fundo escurecido — conteúdo longo pede a tela, não um
// balão por cima da agenda.
//
// `openId`/`onOpenChange` vêm de fora (App.jsx) porque os atalhos de teclado
// também abrem e fecham estes painéis — com o estado preso aqui dentro, não
// havia como um atalho alcançá-lo.
export default function Rail({ tools, openId, onOpenChange }) {
  const wrapRef = useRef(null)
  const setOpenId = onOpenChange
  const open = tools.find((t) => t.id === openId) || null

  useEffect(() => {
    if (!open) return
    function onKey(e) {
      // Um diálogo aberto por cima (editar a tarefa de um projeto, confirmar
      // exclusão) é quem responde ao Esc — fechar o painel de baixo junto
      // jogava fora a tela onde a pessoa estava.
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) close()
    }
    function onPointerDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close()
    }
    window.addEventListener('keydown', onKey)
    // A tela sobreposta abre editores de tarefa e de compromisso, que moram
    // fora do trilho. Fechar no clique de fora derrubava a tela inteira a
    // cada clique nesses editores — ela fecha pelo X, pelo Esc ou pelo fundo.
    if (!open.wide) window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])

  function close() {
    setOpenId(null)
  }

  function handleClick(id) {
    setOpenId(openId === id ? null : id)
  }

  return (
    // No celular o painel aberto vira tela cheia e a barra sai de cena; a
    // classe é o que diz isso ao CSS.
    <div className={`rail-wrap${open ? ' tem-painel' : ''}`} ref={wrapRef}>
      <nav className="rail" aria-label="Ferramentas">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`rail-btn${openId === tool.id ? ' is-open' : ''}${tool.highlight ? ' is-live' : ''}${tool.primary ? ' is-primary' : ''}`}
            onClick={() => handleClick(tool.id)}
            aria-expanded={openId === tool.id}
            aria-label={tool.label}
            title={tool.tecla ? `${tool.label} (${tool.tecla.toUpperCase()})` : tool.label}
          >
            <span className="rail-btn-icon">{tool.icon}</span>
            <span className="rail-btn-label">{tool.label}</span>
            {tool.badge > 0 && <span className="rail-btn-badge">{tool.badge > 99 ? '99+' : tool.badge}</span>}
          </button>
        ))}
      </nav>

      {/* O fundo escurecido é o que faz do painel largo uma tela à parte, e
          não um balão sobre a agenda: clicar nele fecha, como num diálogo. */}
      {open?.wide && <div className="rail-scrim" onClick={close} aria-hidden="true" />}

      {open && (
        <div
          className={`rail-panel card${open.wide ? ' is-wide' : ''}`}
          role={open.wide ? 'dialog' : undefined}
          aria-label={open.label}
        >
          <div className="rail-panel-head">
            <strong>{open.label}</strong>
            <button type="button" className="rail-close" onClick={close} aria-label="Fechar">×</button>
          </div>
          {open.render(close)}
        </div>
      )}
    </div>
  )
}
