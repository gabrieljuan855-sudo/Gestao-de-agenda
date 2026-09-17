import { useEffect, useRef, useState } from 'react'
import { createEvent } from './googleApi.js'
import { FOCUS_TASK_PROP, registerFocusSession } from './focusStats.js'

const PHASE_LABEL = {
  idle: 'Nenhum foco ativo',
  focus: 'Em foco agora',
  break: 'Pausa',
  done: 'Ciclo concluído',
}

const FOCUS_MS = 25 * 60 * 1000
const BREAK_MS = 5 * 60 * 1000
// Abaixo disso o bloco não vira compromisso: é um toque sem querer no play,
// não trabalho. Acima, vale registrar mesmo que o ciclo não tenha completado.
const MIN_BLOCO_MS = 60 * 1000

// A agenda é o registro de onde o tempo foi, não um placar de pomodoros
// completos: encerrar no meio não pode jogar fora o tempo que já passou.
export function valeRegistrarBloco(inicio, fim) {
  if (!inicio || !fim) return false
  return fim - inicio >= MIN_BLOCO_MS
}

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

// `'Notification' in window` não basta: a propriedade pode existir e não ser
// utilizável (extensão de privacidade, navegador embutido de app, contexto sem
// HTTPS). Aí ler `.permission` lança, e a exceção subia de dentro de start() —
// derrubando o pomodoro inteiro por causa de um aviso que é só um extra.
function notificacoesDisponiveis() {
  return typeof window !== 'undefined' && typeof window.Notification === 'function'
}

function notify(title, body) {
  if (!notificacoesDisponiveis() || Notification.permission !== 'granted') return
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
  // 'done' é a pausa que acabou e ainda não virou nada: o ciclo fica
  // esperando você decidir entre emendar outro bloco ou encerrar, em vez de
  // sumir da tela sozinho. Era o que faltava para encadear pomodoros.
  const [phase, setPhase] = useState('idle') // idle | focus | break | done
  const [endsAt, setEndsAt] = useState(null)
  const [pausedLeft, setPausedLeft] = useState(null)
  const [immersive, setImmersive] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // Aviso de "escolha uma tarefa primeiro", mostrado onde o painel já está —
  // em vez do alert() nativo, que quebra o visual do app com a caixa do
  // sistema operacional para um recado tão pequeno.
  const [notice, setNotice] = useState(null)

  const startedAtRef = useRef(null)
  const eventCreatedRef = useRef(false)
  const firingRef = useRef(false)

  const running = (phase === 'focus' || phase === 'break') && pausedLeft === null
  const remaining = pausedLeft !== null ? pausedLeft : endsAt ? endsAt - now : FOCUS_MS

  // Fração já percorrida da fase atual, para o anel de progresso. Parado ou
  // concluído o anel fica cheio: é o ciclo inteiro esperando, não zero.
  const duracaoDaFase = phase === 'break' ? BREAK_MS : FOCUS_MS
  const progress =
    phase === 'idle' || phase === 'done' ? 0 : Math.min(1, Math.max(0, 1 - remaining / duracaoDaFase))

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
        // O bloco correu até o fim de verdade — é isso que conta como sessão,
        // diferente de reiniciar ou encerrar antes da hora.
        if (activeTask) registerFocusSession(activeTask.id, FOCUS_MS / 60000)
        setPhase('break')
        setEndsAt(Date.now() + BREAK_MS)
      } else {
        playChime()
        notify('Pausa terminada', 'Pronto para o próximo bloco.')
        // Não volta para 'idle' nem fecha a tela cheia: fica em 'done', com o
        // próximo bloco a um toque. Fechar sozinho obrigava a caçar o botão do
        // trilho para emendar.
        setPhase('done')
        setEndsAt(null)
        onCycleComplete && onCycleComplete()
      }
      firingRef.current = false
    }

    finishPhase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, remaining, phase])

  // O aviso de "escolha uma tarefa" perde a razão de existir assim que uma é
  // escolhida — sem isso ele ficava preso na tela até o usuário reparar e
  // fechar à mão.
  useEffect(() => {
    if (activeTask) setNotice(null)
  }, [activeTask])

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
    if (!activeTask || eventCreatedRef.current) return false
    const inicio = startedAtRef.current || new Date(Date.now() - FOCUS_MS)
    const fim = new Date()
    if (!valeRegistrarBloco(inicio, fim)) return false
    eventCreatedRef.current = true
    try {
      await createEvent({
        title: `Foco: ${activeTask.title}`,
        start: inicio,
        end: fim,
        description: 'Bloco de foco registrado automaticamente pelo Gestão de Agenda.',
        extendedProperties: { private: { [FOCUS_TASK_PROP]: activeTask.id } },
      })
      return true
    } catch (err) {
      // Antes isto só ia para o console: a pessoa focava, encerrava e nunca
      // ficava sabendo que o bloco não tinha entrado na agenda.
      console.error('Não foi possível registrar o bloco de foco no Calendar:', err)
      setNotice('O bloco de foco não entrou na agenda — o Google recusou a gravação.')
      return false
    }
  }

  // Começa um bloco de foco do zero. Serve para o primeiro da sessão e para
  // todo "de novo": depois da pausa, no lugar dela, ou por cima de um bloco
  // em andamento.
  //
  // Aceita a tarefa por parâmetro para o botão "Focar" do card da tarefa: ele
  // seleciona e inicia no mesmo clique, antes que `activeTask` (que vem de
  // fora, por prop) tenha tempo de chegar num novo render.
  function start(taskOverride) {
    const task = taskOverride || activeTask
    if (!task) {
      setNotice('Escolha uma tarefa na lista antes de iniciar o foco.')
      return
    }
    setNotice(null)
    if (notificacoesDisponiveis() && Notification.permission === 'default') {
      try {
        Notification.requestPermission()
      } catch {
        // Sem permissão de notificar o ciclo roda igual; o som e a tela bastam.
      }
    }
    startedAtRef.current = new Date()
    eventCreatedRef.current = false
    firingRef.current = false
    setPhase('focus')
    setEndsAt(Date.now() + FOCUS_MS)
    setPausedLeft(null)
    setImmersive(true)
  }

  // Recomeça a fase atual do zero, sem trocar de fase: 25 min viram 25 min de
  // novo, uma pausa interrompida volta a 5. O bloco de foco já registrado na
  // agenda não é mexido — o tempo gasto foi gasto.
  function restart() {
    if (phase === 'idle' || phase === 'done') {
      start()
      return
    }
    const duracao = phase === 'focus' ? FOCUS_MS : BREAK_MS
    if (phase === 'focus') {
      startedAtRef.current = new Date()
      eventCreatedRef.current = false
    }
    firingRef.current = false
    setEndsAt(Date.now() + duracao)
    setPausedLeft(null)
    setNow(Date.now())
  }

  function pause() {
    setPausedLeft(Math.max(0, endsAt - Date.now()))
  }

  function resume() {
    setEndsAt(Date.now() + pausedLeft)
    setPausedLeft(null)
    setNow(Date.now())
  }

  // Encerrar no meio de um bloco registrava nada: o tempo já gasto sumia.
  // Agora ele vai para a agenda igual, com a duração real. O contador de
  // sessões (registerFocusSession, lá em cima) continua exigindo o bloco
  // inteiro — contar pomodoro e registrar onde o tempo foi são coisas
  // diferentes, e só a segunda vale para um bloco interrompido.
  function stop() {
    const eraFoco = phase === 'focus'
    setPhase('idle')
    setEndsAt(null)
    setPausedLeft(null)
    setImmersive(false)
    firingRef.current = false
    if (!eraFoco) return
    registerFocusBlock().then((gravou) => {
      if (gravou) onCycleComplete && onCycleComplete()
    })
  }

  function skipBreak() {
    setPhase('done')
    setEndsAt(null)
    setPausedLeft(null)
    firingRef.current = false
    onCycleComplete && onCycleComplete()
  }

  return {
    phase,
    remaining,
    progress,
    running,
    paused: pausedLeft !== null,
    immersive,
    activeTask,
    notice,
    dismissNotice: () => setNotice(null),
    phaseLabel: PHASE_LABEL[phase],
    clock: formatClock(remaining),
    start,
    restart,
    pause,
    resume,
    stop,
    skipBreak,
    openImmersive: () => setImmersive(true),
    closeImmersive: () => setImmersive(false),
  }
}
