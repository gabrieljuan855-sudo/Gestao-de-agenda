import { useEffect } from 'react'

// Quanto da janela está coberto por baixo — na prática, o teclado do celular.
//
// Elemento com position:fixed é posicionado pela viewport de *layout*, e no
// iOS ela não encolhe quando o teclado abre. O resultado é a barra do trilho
// indo parar no meio da tela, por cima do conteúdo, e o painel junto. A
// visualViewport é a que sabe onde está a área realmente visível.
//
// O valor sai numa variável CSS em vez de num estado do React: quem precisa
// dele é o CSS, e assim redigitar não re-renderiza a árvore inteira a cada
// quadro da animação do teclado.
export default function useViewportInset() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    function atualizar() {
      const coberto = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      document.documentElement.style.setProperty('--viewport-inset-bottom', `${Math.round(coberto)}px`)
    }

    atualizar()
    vv.addEventListener('resize', atualizar)
    vv.addEventListener('scroll', atualizar)
    return () => {
      vv.removeEventListener('resize', atualizar)
      vv.removeEventListener('scroll', atualizar)
      document.documentElement.style.removeProperty('--viewport-inset-bottom')
    }
  }, [])
}
