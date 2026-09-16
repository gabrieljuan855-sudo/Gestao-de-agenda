import { useEffect } from 'react'

// Quanto da janela está coberto pelo teclado do celular.
//
// Elemento com position:fixed é posicionado pela viewport de *layout*, e o
// iOS não encolhe essa viewport quando o teclado abre. Sem descontar o
// teclado, a barra do trilho ia parar no meio da tela. A visualViewport sabe
// onde está a área realmente visível.
//
// O problema é que a diferença entre as duas viewports não vem só do teclado:
// a barra de endereço aparecendo e sumindo, as barras do sistema e o efeito
// elástico do rolar também entram nessa conta. Tomar qualquer diferença como
// teclado fazia a barra flutuar no meio da tela sem teclado nenhum. Daí as
// duas condições abaixo — as duas precisam valer:
//
//   1. algum campo de texto está com o foco (sem isso não há teclado aberto);
//   2. a área coberta é grande o bastante para ser um teclado, e não uma
//      barra de navegação.
//
// O valor sai numa variável CSS em vez de num estado do React: quem precisa
// dele é o CSS, e assim a animação do teclado não re-renderiza a árvore
// inteira a cada quadro.
const MINIMO_DE_TECLADO = 150

function temCampoComFoco() {
  const ativo = document.activeElement
  if (!ativo) return false
  if (ativo.isContentEditable) return true
  return /^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName)
}

export default function useViewportInset() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    function atualizar() {
      const coberto = window.innerHeight - vv.height - vv.offsetTop
      const teclado = temCampoComFoco() && coberto > MINIMO_DE_TECLADO ? Math.round(coberto) : 0
      document.documentElement.style.setProperty('--viewport-inset-bottom', `${teclado}px`)
    }

    atualizar()
    vv.addEventListener('resize', atualizar)
    vv.addEventListener('scroll', atualizar)
    // O foco entra na conta, então mudança de foco também precisa recalcular:
    // fechar o teclado nem sempre dispara resize na visualViewport.
    window.addEventListener('focusin', atualizar)
    window.addEventListener('focusout', atualizar)
    window.addEventListener('orientationchange', atualizar)

    return () => {
      vv.removeEventListener('resize', atualizar)
      vv.removeEventListener('scroll', atualizar)
      window.removeEventListener('focusin', atualizar)
      window.removeEventListener('focusout', atualizar)
      window.removeEventListener('orientationchange', atualizar)
      document.documentElement.style.removeProperty('--viewport-inset-bottom')
    }
  }, [])
}
