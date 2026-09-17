import { describe, expect, it } from 'vitest'
import { faltaPermissaoDoDrive } from './driveNotes.js'

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
})
