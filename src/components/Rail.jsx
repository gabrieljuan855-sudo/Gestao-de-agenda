import { useEffect, useRef, useState } from 'react'

// O trilho: três botões redondos na lateral que viram um painel com a
// ferramenta inteira. Ganha espaço na tela — adicionar, cronometrar e anotar
// são coisas que a gente faz de vez em quando, não o tempo todo, então não
// precisam ocupar a página enquanto estão paradas.
//
// Abrir no hover é bom no computador e não existe no celular, então o clique
// também abre. Quem abriu no clique fica preso (pinned): sem isso o painel
// fecharia no meio de uma digitação, assim que o ponteiro saísse dele.
export default function Rail({ tools }) {
  const [openId, setOpenId] = useState(null)
  const [pinned, setPinned] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!openId) return
    function onKey(e) {
      if (e.key === 'Escape') close()
    }
    function onPointerDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [openId])

  function close() {
    setOpenId(null)
    setPinned(false)
  }

  function handleEnter(id) {
    if (!pinned) setOpenId(id)
  }

  function handleLeave() {
    if (!pinned) setOpenId(null)
  }

  function handleClick(id) {
    if (openId === id && pinned) return close()
    setOpenId(id)
    setPinned(true)
  }

  const open = tools.find((t) => t.id === openId) || null

  return (
    <div className="rail-wrap" ref={wrapRef} onMouseLeave={handleLeave}>
      <div className="rail">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`rail-btn${openId === tool.id ? ' is-open' : ''}${tool.highlight ? ' is-live' : ''}`}
            onMouseEnter={() => handleEnter(tool.id)}
            onFocus={() => handleEnter(tool.id)}
            onClick={() => handleClick(tool.id)}
            aria-expanded={openId === tool.id}
            aria-label={tool.label}
            title={tool.label}
          >
            <span className="rail-btn-label">{tool.label}</span>
            <span className="rail-btn-icon">{tool.icon}</span>
          </button>
        ))}
      </div>

      {open && (
        <div className="rail-panel card" onMouseEnter={() => setOpenId(open.id)}>
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
