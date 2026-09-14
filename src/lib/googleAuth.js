// Autenticação client-side usando Google Identity Services (GIS).
// Não usa backend: o token de acesso fica só no navegador do usuário.

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
].join(' ')

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

let tokenClient = null
let currentToken = null
let onTokenChange = () => {}

export function initGoogleAuth(callback) {
  onTokenChange = callback
  if (!window.google || !CLIENT_ID) return

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (response) => {
      if (response && response.access_token) {
        currentToken = response.access_token
        onTokenChange(currentToken)
      }
    },
  })
}

export function signIn() {
  if (!tokenClient) {
    alert('Configuração do Google ainda não carregou. Veja o README para configurar VITE_GOOGLE_CLIENT_ID.')
    return
  }
  tokenClient.requestAccessToken()
}

export function signOut() {
  if (currentToken && window.google) {
    window.google.accounts.oauth2.revoke(currentToken, () => {})
  }
  currentToken = null
  onTokenChange(null)
}

export function getToken() {
  return currentToken
}

export function isConfigured() {
  return Boolean(CLIENT_ID)
}
