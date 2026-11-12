import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Um seletor de caixa de marcar solto no meio da lista de seletores dos campos
// de texto deu 18x18px a todo campo de texto do app (Título, Local...), duas
// vezes seguidas. Só o CSS compilado mostrava, então a regra fica travada aqui.
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('index.css', () => {
  it('a regra da caixa de marcar não divide a lista de seletores com campos de texto ou número', () => {
    const listas = [...css.matchAll(/(^|\})\s*([^{}]+)\{/g)].map((m) => m[2])
    const comCaixa = listas.filter((l) => /input\[type="checkbox"\]/.test(l))
    expect(comCaixa.length).toBeGreaterThan(0)
    for (const lista of comCaixa) {
      expect(lista, `seletores misturados: ${lista.trim()}`).not.toMatch(/input\[type="(text|number|time|date|search|email|url|tel)"\]/)
    }
  })

  it('campo de texto continua sem tamanho fixo (a caixa de marcar é que tem 18px)', () => {
    const regra = css.match(/input\[type="text"\],\s*input\[type="number"\]\s*\{([^}]*)\}/)
    expect(regra).not.toBeNull()
    expect(regra[1]).not.toMatch(/\b(width|height)\s*:/)
  })
})
