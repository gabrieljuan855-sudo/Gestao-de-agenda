import { useEffect, useState } from 'react'

// Altura atual de um elemento, acompanhando o redimensionamento da janela.
// Serve à Semana e ao Mês para decidir quantos compromissos mostrar por dia.
export default function useAltura(ref) {
  const [altura, setAltura] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver(([entrada]) => setAltura(entrada.contentRect.height))
    obs.observe(el)
    return () => obs.disconnect()
  }, [ref])
  return altura
}
