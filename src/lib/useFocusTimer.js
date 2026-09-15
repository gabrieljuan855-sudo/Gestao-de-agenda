import { useEffect, useRef, useState } from 'react'
import { createEvent } from './googleApi.js'

const FOCUS_MS = 25 * 60 * 1000
const BREAK_MS = 5 * 60 * 1000

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2)
    osc.start()
    osc.stop(ctx.currentTime + 1.2)
    osc.onended = () => ctx.close()
  } catch {
    // O som é um extra: se o navegador bloquear o áudio, o ciclo segue igual.
  }
}

function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    new Notification(title, { body })
  } catch {
    // Alguns navegadores móveis exigem service worker; sem ele, só ignoramos.
  }
}

// O estado do pomodoro mora aqui, e não dentro de um componente de tela, porque
// agora três lugares precisam dele ao mesmo tempo: o botão do trilho (que
// mostra o tempo correndo), o painel que abre nele e a tela cheia.
export default function useFocusTimer({ activeTask, onCycleComplete }) {
  const [phase, setPhase] = useState('idle') // idle | focus | break
  const [endsAt, setEndsAt] = useState(null)
  const [pausedLeft, setPausedLeft] = useState(null)
  const [immersive, setImmersive] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const startedAtRef = useRef(null)
  const eventCreatedRef = useRef(false)
  const firingRef = useRef(false)

  const running = phase !== 'idle' && pausedLeft === null
  const remaining = pausedLeft !== null ? pausedLeft : endsAt ? endsAt - now : FOCUS_MS

  // O tempo vem do timestamp de término, não de um contador decrescente: assim
  // bloquear a tela do celular não atrasa o ciclo nem falseia o que é gravado
  // no Calendar.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => {
    if (!running || remaining > 0 || firingRef.current) return
    firingRef.current = true

    async function finishPhase() {
      if (phase === 'focus') {
        playChime()
        notify('Foco concluído', activeTask ? `Bloco de ${activeTask.title} terminado.` : 'Hora da pausa.')
        await registerFocusBlock()
        setPhase('break')
        setEndsAt(Date.now() + BREAK_MS)
      } else {
        playChime()
        notify('Pausa terminada', 'Pronto para o próximo bloco.')
        setPhase('idle')
        setEndsAt(null)
        setImmersive(false)
        onCycleComplete && onCycleComplete()
      }
      firingRef.current = false
    }

    finishPhase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, remaining, phase])

  useEffect(() => {
    if (!immersive) return
    const onKey = (e) => e.key === 'Escape' && setImmersive(false)
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [immersive])

  async function registerFocusBlock() {
    if (!activeTask || eventCreatedRef.current) return
    eventCreatedRef.current = true
    try {
      await createEvent({
        title: `Foco: ${activeTask.title}`,
        start: startedAtRef.current || new Date(Date.now() - FOCUS_MS),
        end: new Date(),
        description: 'Bloco de foco registrado automaticamente pelo Gestão de Agenda.',
      })
    } catch (err) {
      console.error('Não foi possível registrar o bloco de foco no Calendar:', err)
    }
  }

  function start() {
    if (!activeTask) {
      alert('Escolha uma tarefa na lista antes de iniciar o foco.')
      return
    }
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
    startedAtRef.current = new Date()
    eventCreatedRef.current = false
    firingRef.current = false
    setPhase('focus')
    setEndsAt(Date.now() + FOCUS_MS)
    setPausedLeft(null)
    setImmersive(true)
  }

  function pause() {
    setPausedLeft(Math.max(0, endsAt - Date.now()))
  }

  function resume() {
    setEndsAt(Date.now() + pausedLeft)
    setPausedLeft(null)
    setNow(Date.now())
  }

  function stop() {
    setPhase('idle')
    setEndsAt(null)
    setPausedLeft(null)
    setImmersive(false)
    firingRef.current = false
  }

  function skipBreak() {
    setPhase('idle')
    setEndsAt(null)
    setPausedLeft(null)
    setImmersive(false)
    onCycleComplete && onCycleComplete()
  }

  return {
    phase,
    remaining,
    running,
    paused: pausedLeft !== null,
    immersive,
    activeTask,
    phaseLabel: phase === 'idle' ? 'Nenhum foco ativo' : phase === 'focus' ? 'Em foco agora' : 'Pausa',
    clock: formatClock(remaining),
    start,
    pause,
    resume,
    stop,
    skipBreak,
    openImmersive: () => setImmersive(true),
    closeImmersive: () => setImmersive(false),
  }
}
