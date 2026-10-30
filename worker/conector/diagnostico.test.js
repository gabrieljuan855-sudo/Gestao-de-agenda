import { describe, expect, it } from 'vitest'
import worker from '../index.js'
import { kvEmMemoria } from '../teste/kvMemoria.js'
import { resumoDaResposta } from './diagnostico.js'

const ORIGEM = 'https://segundo-cerebro.exemplo.dev'

describe('diagnóstico do conector', () => {
  it('guarda caminho, status e erro, nunca o code nem o state', async () => {
    const request = new Request(`${ORIGEM}/conector/callback?code=SEGREDO&state=OUTRO`)
    const response = new Response(null, {
      status: 302,
      headers: { Location: 'https://claude.ai/api/mcp/auth_callback?code=SEGREDO2&state=x&error=access_denied&error_description=Recusado' },
    })
    const resumo = await resumoDaResposta({ request, response })
    expect(resumo).toMatchObject({
      caminho: '/conector/callback',
      status: 302,
      destino: 'https://claude.ai/api/mcp/auth_callback',
      erro: 'access_denied',
      motivo: 'Recusado',
    })
    expect(JSON.stringify(resumo)).not.toMatch(/SEGREDO|OUTRO/)
  })

  it('ignora chamada de ferramenta que deu certo e guarda a que falhou', async () => {
    const request = new Request(`${ORIGEM}/mcp`, { method: 'POST', headers: { Origin: 'https://claude.ai', Authorization: 'Bearer t' } })
    expect(await resumoDaResposta({ request, response: new Response('ok'), metodo: 'tools/call' })).toBeNull()
    const falha = await resumoDaResposta({ request, response: new Response('{"error":"x"}', { status: 403 }), metodo: 'tools/list' })
    expect(falha).toMatchObject({ status: 403, mcp: 'tools/list', origem: 'https://claude.ai', comToken: true, resposta: '{"error":"x"}' })
    expect(JSON.stringify(falha)).not.toContain('Bearer')
  })

  it('o Worker registra as respostas do conector, e a leitura exige a chave', async () => {
    const env = { OAUTH_KV: kvEmMemoria(), ASSETS: { fetch: async () => new Response('site') } }
    const pendentes = []
    const ctx = { waitUntil: (p) => pendentes.push(p), passThroughOnException() {} }
    const chamar = (caminho) => worker.fetch(new Request(`${ORIGEM}${caminho}`, { headers: { Host: 'segundo-cerebro.exemplo.dev' } }), env, ctx)

    await chamar('/conector/callback?code=x&state=inventado')
    await Promise.all(pendentes)
    expect([...env.OAUTH_KV.dados.keys()].some((k) => k.startsWith('conector-diag:'))).toBe(true)

    expect((await chamar('/conector/diagnostico')).status).toBe(404)
    expect((await chamar('/conector/diagnostico?chave=errada')).status).toBe(404)
  })
})
