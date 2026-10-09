import { useEffect, useRef } from 'react'
import { listAllEvents } from './googleApi.js'
import {
  avisosDevidos,
  textoDoAviso,
  lerAvisados,
  gravarAvisados,
  podarAvisados,
  avisosParaOServidor,
  DIAS_DE_AVISOS_NO_SERVIDOR,
} from './lembretes.js'
import { pushSuportado, inscricaoAtual, enviarAvisos, ehIOS } from './pushAvisos.js'

// Os compromissos que podem pedir aviso, buscados à parte: os eventos da
// tela não servem — quem está olhando o mês de novembro continua precisando
// do aviso da reunião de hoje. A semana inteira, porque a mesma lista vai
// para o servidor avisar com o app fechado.
const JANELA_MS = DIAS_DE_AVISOS_NO_SERVIDOR * 24 * 60 * 60 * 1000
// Reenvia ao servidor mesmo sem mudança, de tempos em tempos: é o que faz
// a lista dele ir andando para a frente enquanto o app fica aberto.
const REENVIO_MS = 30 * 60 * 1000
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
  const ultimoEnvio = useRef({ assinatura: '', em: 0 })
  const avisaPeloServidor = useRef(false)
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
        if (!vivo) return
        eventos.current = lista
        await mandarParaOServidor(agora)
      } catch (err) {
        // Sem rede, segue com a última lista: a reunião das 14h não deixou de
        // existir porque a internet caiu.
        console.warn('Avisos: não deu para atualizar a agenda.', err)
      }
    }

    // Com este aparelho inscrito, a lista da semana vai para o servidor, que
    // avisa mesmo com o app fechado. Só manda de novo quando a lista mudou
    // (ou a cada meia hora), para não repetir o envio a cada busca.
    async function mandarParaOServidor(agora) {
      if (!pushSuportado() || Notification.permission !== 'granted') return
      const inscricao = await inscricaoAtual()
      avisaPeloServidor.current = Boolean(inscricao)
      if (!inscricao) return
      const avisos = avisosParaOServidor(eventos.current, agora, {
        antecedencia: config.antecedencia,
        deveAvisar: (e) => deveAvisarRef.current(e),
      })
      const assinatura = JSON.stringify(avisos.map((a) => [a.id, a.titulo, a.corpo]))
      if (assinatura === ultimoEnvio.current.assinatura && Date.now() - ultimoEnvio.current.em < REENVIO_MS) return
      try {
        await enviarAvisos(inscricao, avisos)
        ultimoEnvio.current = { assinatura, em: Date.now() }
      } catch (err) {
        console.warn('Avisos: não deu para mandar a lista ao servidor.', err)
      }
    }

    function conferir() {
      if (Notification.permission !== 'granted') return
      // No iPhone inscrito, quem avisa é o servidor: avisar daqui também
      // daria dois avisos iguais com o app aberto. No computador os dois
      // convivem — o aviso daqui tem a mesma tag do push e o substitui.
      if (avisaPeloServidor.current && ehIOS()) return
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
    // Acabou de inscrever o aparelho (em Agendas): manda a lista já.
    const aoInscrever = () => {
      ultimoEnvio.current = { assinatura: '', em: 0 }
      buscar().then(conferir)
    }
    window.addEventListener('avisos:inscrito', aoInscrever)
    return () => {
      window.removeEventListener('avisos:inscrito', aoInscrever)
      vivo = false
      clearInterval(busca)
      clearInterval(confere)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [ligado, config.antecedencia])
}
