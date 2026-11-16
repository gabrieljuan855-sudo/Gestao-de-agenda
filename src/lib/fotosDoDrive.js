// As fotos das peças, para mostrar na tela. Elas moram no Drive e só saem de
// lá com o token (o link do Drive pediria login dentro do app instalado),
// então cada uma é baixada uma vez e guardada: em memória enquanto a página
// vive e no armazenamento do navegador entre uma abertura e outra — a grade
// com dezenas de peças não pode baixar tudo de novo a cada visita.
import { baixarDoDrive } from './googleApi.js'

const NOME_DO_CACHE = 'guarda-roupa-fotos'
const emMemoria = new Map() // driveId -> Promise<url de objeto>

const chave = (driveId) => `/__fotos/${encodeURIComponent(driveId)}`

async function doCache(driveId) {
  try {
    const cache = await caches.open(NOME_DO_CACHE)
    const res = await cache.match(chave(driveId))
    return res ? await res.blob() : null
  } catch {
    return null
  }
}

async function paraOCache(driveId, blob) {
  try {
    const cache = await caches.open(NOME_DO_CACHE)
    await cache.put(chave(driveId), new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }))
  } catch {
    // Sem armazenamento (navegação privada, disco cheio): a foto só é
    // baixada de novo na próxima abertura.
  }
}

export function urlDaFoto(driveId) {
  if (!emMemoria.has(driveId)) {
    const promessa = (async () => {
      let blob = await doCache(driveId)
      if (!blob) {
        blob = await baixarDoDrive(driveId)
        paraOCache(driveId, blob)
      }
      return URL.createObjectURL(blob)
    })()
    // Uma falha (sem rede, sem permissão) não fica guardada: a próxima
    // tentativa começa do zero.
    promessa.catch(() => emMemoria.delete(driveId))
    emMemoria.set(driveId, promessa)
  }
  return emMemoria.get(driveId)
}

// A foto que acabou de ser enviada já está no aparelho: mostrá-la não precisa
// de uma ida ao Drive.
export function guardarFoto(driveId, blob) {
  emMemoria.set(driveId, Promise.resolve(URL.createObjectURL(blob)))
  paraOCache(driveId, blob)
}

export function esquecerFoto(driveId) {
  emMemoria.delete(driveId)
  caches?.open?.(NOME_DO_CACHE).then((c) => c.delete(chave(driveId))).catch(() => {})
}
