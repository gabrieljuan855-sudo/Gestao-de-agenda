import { useEffect, useRef } from 'react'
import { listAllEvents } from './googleApi.js'
import { avisosDevidos, textoDoAviso, lerAvisados, gravarAvisados, podarAvisados } from './lembretes.js'

// Os compromissos que podem pedir aviso: das próximas 26 horas, buscados à
// parte. Os eventos da tela não servem — quem está olhando o mês de novembro
// continua precisando do aviso da reunião de hoje.
const JANELA_MS = 26 * 60 * 60 * 1000
const BUSCA_A_CADA_MS = 5 * 60 * 1000
// Aba em segundo plano roda timer no máximo uma vez por minuto (o navegador
// segura), então conferir mais vezes que isso não ganha precisão.
const CONFERE_A_CADA_MS = 30 * 1000

export function avisosSuportados() {
  return typeof window !== 'undefined' && 'Notification' in window
}

async function mostrar(titulo, opcoes) {
  // Pelo service worker a notificação funciona também no app instalado e
  // sobrevive à aba ficar em segundo plano; `new Notification` é a reserva
  // para quando ele não estiver ativo.
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg?.showNotification) {
      await reg.showNotification(titulo, opcoes)
      return
    }
  } catch {
    // cai na reserva
  }
  const n = new Notification(titulo, opcoes)
  n.onclick = () => {
    window.focus()
    n.close()
  }
}

export function mostrarAvisoDeTeste() {
  return mostrar('Avisos ligados', {
    body: 'É assim que o Segundo Cérebro vai avisar antes de cada compromisso.',
    icon: '/icon-192.png',
    tag: 'teste-de-aviso',
  })
}

export default function useLembretes({ signedIn, config, deveAvisar }) {
  const eventos = useRef([])
  const deveAvisarRef = useRef(deveAvisar)
  deveAvisarRef.current = deveAvisar

  const ligado = signedIn && config.ativo && avisosSuportados()

  useEffect(() => {
    if (!ligado) return undefined
    let vivo = true

    async function buscar() {
      try {
        const agora = new Date()
        const lista = await listAllEvents({ timeMin: agora, timeMax: new Date(agora.getTime() + JANELA_MS) })
        if (vivo) eventos.current = lista
      } catch (err) {
        // Sem rede, segue com a última lista: a reunião das 14h não deixou de
        // existir porque a internet caiu.
        console.warn('Avisos: não deu para atualizar a agenda.', err)
      }
    }

    function conferir() {
      if (Notification.permission !== 'granted') return
      const agora = new Date()
      let avisados = podarAvisados(lerAvisados(), agora)
      const devidos = avisosDevidos(eventos.current, agora, {
        antecedencia: config.antecedencia,
        avisados,
        deveAvisar: (e) => deveAvisarRef.current(e),
      })
      for (const { event, chaves } of devidos) {
        const { titulo, corpo } = textoDoAviso(event, agora)
        mostrar(titulo, {
          body: corpo,
          icon: '/icon-192.png',
          // A mesma tag substitui o aviso anterior do mesmo compromisso em
          // vez de empilhar dois.
          tag: `compromisso-${event.id}`,
          requireInteraction: false,
          data: { url: '/' },
        }).catch((err) => console.warn('Avisos: o navegador recusou a notificação.', err))
        avisados = new Set([...avisados, ...chaves])
      }
      gravarAvisados(avisados)
    }

    buscar().then(conferir)
    const busca = setInterval(buscar, BUSCA_A_CADA_MS)
    const confere = setInterval(conferir, CONFERE_A_CADA_MS)
    // Ao voltar para a aba (ou acordar o computador), confere na hora em vez
    // de esperar o próximo ciclo do timer.
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') buscar().then(conferir)
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      vivo = false
      clearInterval(busca)
      clearInterval(confere)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [ligado, config.antecedencia])
}
