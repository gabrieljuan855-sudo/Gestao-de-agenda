import { useEffect, useRef } from 'react'
import { atalhoDoEvento, textoParaCapturar } from './atalhos.js'

// Um listener só, na janela, despachando pelo que atalhoDoEvento decidir.
//
// O mapa de ações muda a cada render (fecha sobre estado do App), mas o
// listener não é reinstalado por isso: fica num ref. Sem isso, cada tecla
// digitada em qualquer lugar do app removeria e registraria o listener de
// novo.
export default function useAtalhos(acoes) {
  const acoesRef = useRef(acoes)
  acoesRef.current = acoes

  useEffect(() => {
    function onKeyDown(event) {
      const nome = atalhoDoEvento(event)
      if (!nome) {
        // Um diálogo aberto por cima é quem recebe o que se digita, não a
        // captura que abriria por trás dele.
        const texto = textoParaCapturar(event)
        if (texto && acoesRef.current.digitar && !document.querySelector('.modal-backdrop')) {
          event.preventDefault()
          acoesRef.current.digitar(texto)
        }
        return
      }
      const fn = acoesRef.current[nome]
      if (!fn) return
      // Só depois de saber que a tecla é nossa E que há o que fazer: assim
      // "/" continua abrindo a busca rápida do navegador quando o app não
      // tem nada ligado nela.
      event.preventDefault()
      fn()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
