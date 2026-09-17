import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Só existe para o app abrir mesmo com rede ruim (ver public/sw.js) — sem
// service worker disponível (navegador antigo, contexto sem HTTPS em dev) o
// app funciona igual, só sem essa rede de segurança.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
