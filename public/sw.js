// Service worker: existe para o app abrir na hora, não para funcionar de
// verdade sem internet — a agenda em si sempre precisa da API do Google.
//
// Antes era "rede primeiro" para tudo, e por isso cada abertura no celular
// esperava a página, o JS e as fontes virem da internet, mesmo já estando
// guardados. Agora o que já foi visto abre do cache e a rede só confirma por
// trás: a página guardada aparece na hora e a versão nova (se houver) fica
// pronta para a próxima abertura — o aviso de "versão nova" (useNovaVersao)
// continua perguntando ao servidor direto, então ninguém fica preso numa
// versão velha sem saber.
const CACHE_NAME = 'gestao-agenda-v5'

// Só o essencial para a página conseguir montar sozinha: os arquivos com hash
// do build (JS/CSS) entram no cache sozinhos, na primeira vez que passam por
// aqui — não têm como ser listados de antemão, o nome muda a cada deploy.
const APP_SHELL = [
  '/',
  '/site.webmanifest',
  '/logo.svg',
  '/apple-touch-icon.png',
  '/favicon-32.png',
  '/favicon-16.png',
  '/icon-192.png',
  '/icon-512.png',
]

// As fontes vêm do Google e bloqueiam a primeira pintura da tela. O arquivo
// de cada versão da fonte nunca muda, então guardá-las de vez é seguro.
const FONTES = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        // Uma falha aqui (rede instável bem na instalação) não pode impedir
        // o service worker de assumir — ele só fica com menos coisa em cache.
      })
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

// Aviso que chega do servidor com o app fechado (worker/avisos.js). O
// conteúdo já vem pronto; aqui só vira notificação. A tag é a mesma do aviso
// feito pelo app aberto, então um substitui o outro em vez de duplicar.
self.addEventListener('push', (event) => {
  let dados = {}
  try {
    dados = event.data ? event.data.json() : {}
  } catch {
    dados = { corpo: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(dados.titulo || 'Compromisso', {
      body: dados.corpo || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: dados.tag || undefined,
      data: { url: '/' },
    })
  )
})

// Clicar no aviso de compromisso traz o app para a frente: a aba que já
// estiver aberta, ou uma nova se não houver nenhuma.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((abertas) => {
      const aba = abertas.find((c) => new URL(c.url).origin === self.location.origin)
      if (aba) return aba.focus()
      return self.clients.openWindow(event.notification.data?.url || '/')
    })
  )
})

// Cache primeiro: serve o guardado e só vai à rede quando não houver nada.
function doCacheOuRede(request) {
  return caches.match(request).then(
    (cached) =>
      cached ||
      fetch(request).then((response) => {
        if (response.ok || response.type === 'opaque') {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
  )
}

// Cada deploy troca o nome dos arquivos com hash; sem esta limpeza, o cache
// guardaria todas as versões já publicadas. Fica só o que a página nova usa
// (a página antiga, se ainda estiver aberta, já carregou os dela).
async function limparAssetsVelhos(html) {
  const cache = await caches.open(CACHE_NAME)
  const chaves = await cache.keys()
  await Promise.all(
    chaves
      .filter((req) => {
        const { pathname } = new URL(req.url)
        return pathname.startsWith('/assets/') && !html.includes(pathname.slice(1))
      })
      .map((req) => cache.delete(req))
  )
}

// A página é guardada sempre como "/", seja qual for a query (?erro_login,
// captura pelo atalho): o conteúdo é o mesmo, e é a própria página que lê a
// query. Revalida com o servidor em toda abertura, mas sem fazer ninguém
// esperar por isso.
function abrirPagina(event) {
  const daRede = fetch(event.request, { cache: 'no-cache' }).then(async (response) => {
    if (response.ok && !response.redirected) {
      const html = await response.clone().text()
      const cache = await caches.open(CACHE_NAME)
      await cache.put('/', response.clone())
      await limparAssetsVelhos(html)
    }
    return response
  })
  event.waitUntil(daRede.catch(() => {}))
  return caches.match('/').then((cached) => cached || daRede)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  // Só GET faz sentido guardar: repetir um POST (login, gravar evento) teria
  // efeito colateral duplicado, e continua exigindo rede de qualquer jeito.
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (FONTES.includes(url.origin)) {
    event.respondWith(doCacheOuRede(request))
    return
  }
  if (url.origin !== self.location.origin) return
  // Rotas do próprio Worker nunca passam por aqui: autenticação e a
  // interpretação por IA sempre precisam de uma resposta fresca do servidor.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(abrirPagina(event))
    return
  }
  // Com hash no nome, o conteúdo nunca muda: não há o que conferir na rede.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(doCacheOuRede(request))
    return
  }

  // O resto (ícones, manifesto, a checagem de versão nova) continua rede
  // primeiro, com o cache só de reserva.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  )
})
