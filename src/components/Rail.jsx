import { useEffect, useRef } from 'react'

// O trilho: três botões redondos na lateral que viram um painel com a
// ferramenta inteira. Ganha espaço na tela — adicionar, cronometrar e anotar
// são coisas que a gente faz de vez em quando, não o tempo todo, então não
// precisam ocupar a página enquanto estão paradas.
//
// O painel só abre no clique, em qualquer dispositivo. A primeira versão
// abria no hover também: passar o mouse perto do trilho já estourava o
// painel por cima da lista de tarefas, sem transição nenhuma — um "pulinho"
// a cada vez que o cursor cruzava aquele canto da tela. O hover agora só
// expande o rótulo da pílula (efeito puramente em CSS, via :hover), que é
// a prévia que ele deveria ser desde o início.
// `openId`/`onOpenChange` vêm de fora (App.jsx) porque os atalhos de teclado
// também abrem e fecham estes painéis — com o estado preso aqui dentro, não
// havia como um atalho alcançá-lo.
export default function Rail({ tools, openId, onOpenChange }) {
  const wrapRef = useRef(null)
  const setOpenId = onOpenChange

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
  }

  function handleClick(id) {
    setOpenId(openId === id ? null : id)
  }

  const open = tools.find((t) => t.id === openId) || null

  return (
    // No celular o painel aberto vira tela cheia e a barra sai de cena; a
    // classe é o que diz isso ao CSS.
    <div className={`rail-wrap${open ? " tem-painel" : ""}`} ref={wrapRef}>
      <div className="rail">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`rail-btn${openId === tool.id ? ' is-open' : ''}${tool.highlight ? ' is-live' : ''}${tool.primary ? ' is-primary' : ''}`}
            onClick={() => handleClick(tool.id)}
            aria-expanded={openId === tool.id}
            aria-label={tool.label}
            // A tecla no title é metade da descoberta dos atalhos (a outra
            // metade é a lista no "?"): atalho que ninguém vê é atalho que
            // ninguém usa.
            title={tool.tecla ? `${tool.label} (${tool.tecla.toUpperCase()})` : tool.label}
          >
            <span className="rail-btn-label">{tool.label}</span>
            <span className="rail-btn-icon">{tool.icon}</span>
          </button>
        ))}
      </div>

      {open && (
        <div className="rail-panel card">
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
