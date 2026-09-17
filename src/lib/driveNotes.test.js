import { describe, expect, it } from 'vitest'
import { faltaPermissaoDoDrive, driveApiDesativada, motivoDoGoogle } from './driveNotes.js'

// O corpo que o Google devolve quando a API do Drive não foi ativada no
// projeto — o 403 que não tem nada a ver com login nem com permissão.
const API_DESATIVADA = JSON.stringify({
  error: {
    code: 403,
    message:
      'Google Drive API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=123456 then retry.',
    status: 'PERMISSION_DENIED',
    details: [{ reason: 'SERVICE_DISABLED' }],
  },
})

function erroDaApi(status, body) {
  const err = new Error(`Erro na API do Google (${status}): ${body}`)
  err.status = status
  err.body = body
  return err
}

describe('faltaPermissaoDoDrive', () => {
  it('reconhece o 403 de escopo insuficiente do Drive', () => {
    expect(
      faltaPermissaoDoDrive(
        erroDaApi(403, '{"error":{"message":"Request had insufficient authentication scopes.","status":"PERMISSION_DENIED"}}')
      )
    ).toBe(true)
    expect(faltaPermissaoDoDrive(erroDaApi(403, 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'))).toBe(true)
  })

  it('não confunde com um 403 de outra natureza (cota, por exemplo)', () => {
    expect(faltaPermissaoDoDrive(erroDaApi(403, '{"error":{"message":"User rate limit exceeded."}}'))).toBe(false)
  })

  it('não confunde com falha de rede nem com outros códigos', () => {
    expect(faltaPermissaoDoDrive(erroDaApi(500, 'Backend Error'))).toBe(false)
    expect(faltaPermissaoDoDrive(erroDaApi(404, 'File not found'))).toBe(false)
    expect(faltaPermissaoDoDrive(new Error('Failed to fetch'))).toBe(false)
    expect(faltaPermissaoDoDrive(undefined)).toBe(false)
  })

  it('não confunde a API desativada com falta de permissão — são consertos diferentes', () => {
    // Um pede um login novo, o outro pede um clique no console do Google
    // Cloud. Trocar os dois manda a pessoa refazer login para sempre.
    expect(faltaPermissaoDoDrive(erroDaApi(403, API_DESATIVADA))).toBe(false)
  })
})

describe('driveApiDesativada', () => {
  it('reconhece o 403 de API não ativada no projeto', () => {
    expect(driveApiDesativada(erroDaApi(403, API_DESATIVADA))).toBe(true)
    expect(driveApiDesativada(erroDaApi(403, '{"error":{"errors":[{"reason":"accessNotConfigured"}]}}'))).toBe(true)
  })

  it('não confunde com falta de permissão nem com cota', () => {
    expect(driveApiDesativada(erroDaApi(403, 'Request had insufficient authentication scopes.'))).toBe(false)
    expect(driveApiDesativada(erroDaApi(403, '{"error":{"message":"User rate limit exceeded."}}'))).toBe(false)
    expect(driveApiDesativada(erroDaApi(500, 'Backend Error'))).toBe(false)
  })
})

describe('motivoDoGoogle', () => {
  it('extrai a frase que o Google escreveu', () => {
    expect(motivoDoGoogle(erroDaApi(403, API_DESATIVADA))).toContain('has not been used in project')
  })

  it('devolve vazio quando o corpo não é o JSON esperado', () => {
    expect(motivoDoGoogle(erroDaApi(500, 'Backend Error'))).toBe('')
    expect(motivoDoGoogle(undefined)).toBe('')
  })
})
