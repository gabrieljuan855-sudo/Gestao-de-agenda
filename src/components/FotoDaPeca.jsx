import { useEffect, useState } from 'react'
import { urlDaFoto } from '../lib/fotosDoDrive.js'

// A foto de uma peça, vinda do Drive pelo token (ver fotosDoDrive.js).
// Enquanto não chega — ou se não chegar — fica o cabide no lugar, do mesmo
// tamanho, para a grade não pular quando as fotos entram.
export default function FotoDaPeca({ peca, className = '' }) {
  const driveId = peca?.foto?.driveId
  const [url, setUrl] = useState(null)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    let vivo = true
    setUrl(null)
    setFalhou(false)
    if (!driveId) {
      setFalhou(true)
      return undefined
    }
    urlDaFoto(driveId)
      .then((u) => vivo && setUrl(u))
      .catch(() => vivo && setFalhou(true))
    return () => {
      vivo = false
    }
  }, [driveId])

  const descricao = peca?.nome || 'Peça sem nome'
  if (url) return <img className={`gr-foto ${className}`} src={url} alt={descricao} loading="lazy" />
  return (
    <div className={`gr-foto is-vazia ${className}`} role="img" aria-label={falhou ? `${descricao} (foto indisponível)` : descricao}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 8a2 2 0 1 0-2-2" />
        <path d="M12 8v2l8.5 6a1.5 1.5 0 0 1-.9 2.7H4.4a1.5 1.5 0 0 1-.9-2.7L12 10" />
      </svg>
    </div>
  )
}
