import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'

const STORAGE_KEY = 'gestao-agenda:anotacoes'

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    // Navegador anônimo ou dados de site bloqueados: segue com o campo vazio.
    return ''
  }
}

export default function Scratchpad() {
  const [text, setText] = useState(readStored)
  const [savedAt, setSavedAt] = useState(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const firstRender = useRef(true)

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, text)
        setSavedAt(new Date())
      } catch {
        // Sem espaço ou sem permissão: o texto continua na tela, só não persiste.
      }
    }, 500)
    return () => clearTimeout(id)
  }, [text])

  function clear() {
    if (!text.trim()) {
      setText('')
      return
    }
    setConfirmingClear(true)
  }

  return (
    <>
      <div>
        <div className="panel-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
            <span className="muted" style={{ fontSize: 'var(--label-sm)' }}>
              {text.length > 0 && `${text.length} caracteres`}
              {savedAt && ` · salvo ${savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
            </span>
            {text.length > 0 && <button onClick={clear}>Limpar</button>}
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Espaço livre para rascunhar, pensar em voz alta, colar algo que você não quer perder..."
          rows={12}
        />

        <div className="muted" style={{ fontSize: 'var(--label-sm)', marginTop: 6 }}>
          Fica salvo neste navegador, sem passar por servidor nenhum.
        </div>
      </div>

      {confirmingClear && (
        <ConfirmDialog
          title="Apagar anotações"
          message="Apagar tudo o que está escrito aqui?"
          confirmLabel="Apagar"
          danger
          onConfirm={() => {
            setConfirmingClear(false)
            setText('')
          }}
          onCancel={() => setConfirmingClear(false)}
        />
      )}
    </>
  )
}
