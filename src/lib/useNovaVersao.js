import { useEffect, useState } from 'react'
import { extrairVersao, temVersaoNova } from './versao.js'

const INTERVALO_MS = 30 * 60 * 1000

// Confere, ao voltar para a janela e a cada meia hora, se foi publicada uma
// versão mais nova do que a que está carregada (ver versao.js).
export default function useNovaVersao() {
  const [novaVersao, setNovaVersao] = useState(false)

  useEffect(() => {
    const atual = extrairVersao(document.querySelector('script[src*="assets/index-"]')?.getAttribute('src'))
    if (!atual) return
    async function conferir() {
      if (document.visibilityState === 'hidden') return
      try {
        // `no-store` passa por cima do cache do navegador e do service worker
        // guardado: a pergunta é justamente o que está publicado agora.
        const res = await fetch('/', { cache: 'no-store' })
        if (res.ok && temVersaoNova(atual, extrairVersao(await res.text()))) setNovaVersao(true)
      } catch {
        // Sem rede: pergunta de novo na próxima vez.
      }
    }
    conferir()
    const id = setInterval(conferir, INTERVALO_MS)
    document.addEventListener('visibilitychange', conferir)
    window.addEventListener('focus', conferir)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', conferir)
      window.removeEventListener('focus', conferir)
    }
  }, [])

  return novaVersao
}
