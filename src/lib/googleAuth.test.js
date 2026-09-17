import { describe, expect, it } from 'vitest'
import { incluiEscopoDoDrive } from './googleAuth.js'

const DRIVE = 'https://www.googleapis.com/auth/drive.appdata'
const CALENDAR = 'https://www.googleapis.com/auth/calendar'
const TASKS = 'https://www.googleapis.com/auth/tasks'

describe('incluiEscopoDoDrive', () => {
  it('reconhece o escopo concedido junto dos outros', () => {
    expect(incluiEscopoDoDrive(`${CALENDAR} ${TASKS} ${DRIVE}`)).toBe(true)
  })

  it('acusa a falta quando o Google concedeu só os antigos', () => {
    expect(incluiEscopoDoDrive(`${CALENDAR} ${TASKS}`)).toBe(false)
  })

  it('não confunde com um escopo do Drive que não é o appdata', () => {
    expect(incluiEscopoDoDrive('https://www.googleapis.com/auth/drive.file')).toBe(false)
  })

  it('devolve null quando não há informação — sem acusar falta sem base', () => {
    // Sessão guardada antes de este campo existir: não saber é diferente de
    // saber que falta, e só o segundo caso justifica pedir um login novo.
    expect(incluiEscopoDoDrive('')).toBeNull()
    expect(incluiEscopoDoDrive(undefined)).toBeNull()
    expect(incluiEscopoDoDrive(null)).toBeNull()
  })
})
