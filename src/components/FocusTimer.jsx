import { useEffect, useRef, useState } from 'react'
import { createEvent } from '../lib/googleApi.js'

const FOCUS_SECONDS = 25 * 60
const BREAK_SECONDS = 5 * 60

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function FocusTimer({ activeTask, onCycleComplete }) {
  const [phase, setPhase] = useState('idle') // idle | focus | break
  const [secondsLeft, setSecondsLeft] = useState(FOCUS_SECONDS)
  const startRef = useRef(null)
  const eventCreatedRef = useRef(false)

  useEffect(() => {
    if (phase === 'idle') return
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id)
          handlePhaseEnd()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  async function handlePhaseEnd() {
    if (phase === 'focus') {
      await registerRealEvent()
      setPhase('break')
      setSecondsLeft(BREAK_SECONDS)
    } else {
      setPhase('idle')
      onCycleComplete && onCycleComplete()
    }
  }

  async function registerRealEvent() {
    if (!activeTask || eventCreatedRef.current) return
    eventCreatedRef.current = true
    const start = startRef.current || new Date(Date.now() - FOCUS_SECONDS * 1000)
    const end = new Date()
    try {
      await createEvent({
        title: `Foco: ${activeTask.title}`,
        start,
        end,
        description: 'Bloco de foco registrado automaticamente pelo Gestão de Agenda.',
      })
    } catch (err) {
      console.error('Não foi possível registrar o bloco de foco no Calendar:', err)
    }
  }

  function start() {
    if (!activeTask) {
      alert('Escolha uma tarefa do backlog antes de iniciar o foco.')
      return
    }
    startRef.current = new Date()
    eventCreatedRef.current = false
    setPhase('focus')
    setSecondsLeft(FOCUS_SECONDS)
  }

  function stop() {
    setPhase('idle')
  }

  return (
    <div className="card" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div className="muted">{phase === 'idle' ? 'Nenhum foco ativo' : phase === 'focus' ? 'Em foco agora' : 'Pausa'}</div>
        <div style={{ fontWeight: 500 }}>{activeTask ? activeTask.title : 'Selecione uma tarefa no backlog'}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>{formatTime(secondsLeft)}</span>
        {phase === 'idle' ? (
          <button className="primary" onClick={start}>Iniciar</button>
        ) : (
          <button onClick={stop}>Parar</button>
        )}
      </div>
    </div>
  )
}
