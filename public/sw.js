// Service worker mínimo: existe só para o app abrir mesmo com rede ruim ou
// instável, não para funcionar de verdade sem internet — a agenda em si
// sempre precisa da API do Google. "Rede primeiro, cache como reserva": toda
// resposta boa atualiza o cache, e só quando a rede falha é que o que já foi
// visto antes entra em cena, em vez de uma tela branca.
const CACHE_NAME = 'gestao-agenda-v3'

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

self.addEventListener('fetch', (event) => {
  const { request } = event
  // Só GET faz sentido guardar: repetir um POST (login, gravar evento) teria
  // efeito colateral duplicado, e continua exigindo rede de qualquer jeito.
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Rotas do próprio Worker nunca passam por aqui: autenticação e a
  // interpretação por IA sempre precisam de uma resposta fresca do servidor.
  if (url.pathname.startsWith('/api/')) return

  // A página em si revalida sempre com o servidor: servida do cache HTTP do
  // navegador, uma versão antiga do app continuava aparecendo depois de
  // publicada a nova. Os arquivos com hash (JS/CSS) podem vir do cache à
  // vontade — o nome já muda quando o conteúdo muda.
  const doServidor = request.mode === 'navigate' ? fetch(request, { cache: 'no-cache' }) : fetch(request)

  event.respondWith(
    doServidor
      .then((response) => {
        const copy = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        return response
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  )
})
