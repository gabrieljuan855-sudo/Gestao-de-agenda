import { useState } from 'react'
import {
  opcoesDeRepeticao,
  opcaoDaRegra,
  regraDaOpcao,
  opcoesMensais,
  descreverRegra,
  DIAS_DA_SEMANA,
} from '../lib/recorrencia.js'
import { toDateInput, addDays } from '../lib/dates.js'

const UNIDADES = [
  { freq: 'DAILY', um: 'dia', varios: 'dias' },
  { freq: 'WEEKLY', um: 'semana', varios: 'semanas' },
  { freq: 'MONTHLY', um: 'mês', varios: 'meses' },
  { freq: 'YEARLY', um: 'ano', varios: 'anos' },
]

// O seletor de repetição como o do Google: as opções rápidas escritas com a
// data do próprio compromisso ("Semanal: cada quinta-feira") e, no fim,
// "Personalizar…", que abre logo abaixo intervalo, dias e término. Fica no
// próprio formulário, e não num diálogo por cima: é parte do compromisso que
// está sendo editado, e um terceiro nível de janela confundiria mais do que
// ajudaria.
export default function Repeticao({ data, status, lida, escolha, onEscolha }) {
  const [aberto, setAberto] = useState(false)

  const regraAtual = escolha?.personalizada || (typeof escolha === 'string' ? regraDaOpcao(escolha, data) : lida?.regra) || null

  let valor
  if (escolha?.personalizada) valor = 'personalizada'
  else if (typeof escolha === 'string') valor = escolha
  else if (status === 'carregando') valor = 'carregando'
  else if (status === 'erro') valor = 'erro'
  else if (lida && !lida.suportada) valor = 'externa'
  else valor = opcaoDaRegra(lida?.regra, data)

  function escolher(id) {
    if (id === 'personalizar') {
      onEscolha({ personalizada: regraAtual || regraDaOpcao('semanal', data) })
      setAberto(true)
      return
    }
    setAberto(false)
    onEscolha(id)
  }

  return (
    <div className="field">
      <span>Repetir</span>
      <select value={valor} onChange={(e) => escolher(e.target.value)} disabled={status === 'carregando'}>
        {valor === 'carregando' && <option value="carregando">Carregando a repetição…</option>}
        {/* Sem a regra, a escolha certa é não mexer: "Não se repete" aqui
            apagaria uma repetição que existe. */}
        {valor === 'erro' && <option value="erro">Repete (não deu para ler a regra)</option>}
        {valor === 'externa' && <option value="externa">Personalizada (feita em outro lugar)</option>}
        {opcoesDeRepeticao(data).map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
        {valor === 'personalizada' && <option value="personalizada">{descreverRegra(regraAtual, data)}</option>}
        <option value="personalizar">Personalizar…</option>
      </select>
      {valor === 'personalizada' && !aberto && (
        <button type="button" className="repeticao-ajustar" onClick={() => escolher('personalizar')}>
          Ajustar repetição
        </button>
      )}
      {aberto && escolha?.personalizada && (
        <Personalizar
          regra={escolha.personalizada}
          data={data}
          onChange={(r) => onEscolha({ personalizada: r })}
          onPronto={() => setAberto(false)}
        />
      )}
    </div>
  )
}

function Personalizar({ regra, data, onChange, onPronto }) {
  const codigoDaData = DIAS_DA_SEMANA[data.getDay()].codigo
  const unidade = UNIDADES.find((u) => u.freq === regra.freq)
  const mensais = opcoesMensais(data)
  const valorMensal = regra.diaDaSemana ? `semana${regra.ordinal}` : 'dia'
  const mensalConhecida = mensais.some((m) => m.id === valorMensal && (regra.diaDaSemana ? m.extra.diaDaSemana === regra.diaDaSemana : m.extra.diaDoMes === regra.diaDoMes))

  function trocarFrequencia(freq) {
    const base = { freq, intervalo: regra.intervalo, fim: regra.fim }
    if (freq === 'WEEKLY') base.dias = [codigoDaData]
    if (freq === 'MONTHLY') base.diaDoMes = data.getDate()
    onChange(base)
  }

  function alternarDia(codigo) {
    const tem = regra.dias.includes(codigo)
    // Pelo menos um dia: semanal sem dia nenhum não é regra que o Google aceite.
    if (tem && regra.dias.length === 1) return
    const dias = DIAS_DA_SEMANA.map((d) => d.codigo).filter((c) => (c === codigo ? !tem : regra.dias.includes(c)))
    onChange({ ...regra, dias })
  }

  function trocarMensal(id) {
    const opcao = mensais.find((m) => m.id === id)
    if (!opcao) return
    const { diaDoMes, ordinal, diaDaSemana, ...resto } = regra
    onChange({ ...resto, ...opcao.extra })
  }

  function trocarFim(tipo) {
    if (tipo === 'nunca') onChange({ ...regra, fim: { tipo } })
    // Os mesmos valores iniciais do Google: uns três meses à frente, ou 13 vezes.
    if (tipo === 'data') onChange({ ...regra, fim: { tipo, data: regra.fim?.data || toDateInput(addDays(data, 90)) } })
    if (tipo === 'vezes') onChange({ ...regra, fim: { tipo, vezes: regra.fim?.vezes || 13 } })
  }

  return (
    <div className="repeticao-painel">
      <div className="repeticao-linha">
        <span>Repetir a cada</span>
        <input
          type="number"
          min={1}
          max={99}
          value={regra.intervalo}
          onChange={(e) => onChange({ ...regra, intervalo: Math.min(99, Math.max(1, Number(e.target.value) || 1)) })}
          aria-label="Intervalo"
        />
        <select value={regra.freq} onChange={(e) => trocarFrequencia(e.target.value)} aria-label="Unidade">
          {UNIDADES.map((u) => (
            <option key={u.freq} value={u.freq}>{regra.intervalo > 1 ? u.varios : u.um}</option>
          ))}
        </select>
      </div>

      {regra.freq === 'WEEKLY' && (
        <div className="repeticao-bloco">
          <span>Repetir</span>
          {/* Chips de filtro do MD3: cada dia liga e desliga, e o estado
              escolhido é o que diz qual está na regra. */}
          <div className="dias-semana" role="group" aria-label="Dias da semana">
            {DIAS_DA_SEMANA.map((d) => (
              <button
                key={d.codigo}
                type="button"
                className={`dia-chip${regra.dias.includes(d.codigo) ? ' is-escolhido' : ''}`}
                aria-pressed={regra.dias.includes(d.codigo)}
                aria-label={d.nome}
                title={d.nome}
                onClick={() => alternarDia(d.codigo)}
              >
                {d.curto}
              </button>
            ))}
          </div>
        </div>
      )}

      {regra.freq === 'MONTHLY' && (
        <select value={mensalConhecida ? valorMensal : 'atual'} onChange={(e) => trocarMensal(e.target.value)} aria-label="Dia do mês">
          {!mensalConhecida && <option value="atual">{descreverRegra({ ...regra, intervalo: 1, fim: null }, data)}</option>}
          {mensais.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      )}

      <div className="repeticao-bloco" role="radiogroup" aria-label="Termina">
        <span>Termina</span>
        <label className="radio-linha">
          <input type="radio" name="fim-repeticao" checked={regra.fim?.tipo !== 'data' && regra.fim?.tipo !== 'vezes'} onChange={() => trocarFim('nunca')} />
          <span>Nunca</span>
        </label>
        <label className="radio-linha">
          <input type="radio" name="fim-repeticao" checked={regra.fim?.tipo === 'data'} onChange={() => trocarFim('data')} />
          <span>Em</span>
          <input
            type="date"
            value={regra.fim?.tipo === 'data' ? regra.fim.data : ''}
            disabled={regra.fim?.tipo !== 'data'}
            onChange={(e) => e.target.value && onChange({ ...regra, fim: { tipo: 'data', data: e.target.value } })}
          />
        </label>
        <label className="radio-linha">
          <input type="radio" name="fim-repeticao" checked={regra.fim?.tipo === 'vezes'} onChange={() => trocarFim('vezes')} />
          <span>Após</span>
          <input
            type="number"
            min={1}
            max={999}
            value={regra.fim?.tipo === 'vezes' ? regra.fim.vezes : 13}
            disabled={regra.fim?.tipo !== 'vezes'}
            onChange={(e) => onChange({ ...regra, fim: { tipo: 'vezes', vezes: Math.min(999, Math.max(1, Number(e.target.value) || 1)) } })}
            aria-label="Número de ocorrências"
          />
          <span>ocorrências</span>
        </label>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onPronto}>Pronto</button>
      </div>
    </div>
  )
}
