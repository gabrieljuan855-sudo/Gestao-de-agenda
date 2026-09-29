// Uma agenda entre várias, num controle só do tamanho de um chip. Com oito
// agendas, uma fileira de chips virava três linhas empurrando a agenda para
// baixo; o seletor ocupa sempre o mesmo lugar, com a cor da escolhida à
// vista. É um <select> de verdade por baixo — no celular abre a lista nativa
// do sistema, que é a melhor forma de escolher entre muitas opções ali.
function nomeDa(cal) {
  return cal.summaryOverride || cal.summary || 'Agenda'
}

export default function SeletorDeAgenda({ agendas, valor, onChange, rotulo, rotuloTodas }) {
  const escolhida = agendas.find((c) => c.id === valor) || null
  return (
    <label className={`seletor-agenda${escolhida && rotuloTodas ? ' is-filtrando' : ''}`}>
      <span className="seletor-agenda-rotulo">{rotulo}</span>
      <span
        className="seletor-agenda-cor"
        style={{ background: escolhida ? escolhida.backgroundColor || 'var(--accent)' : 'transparent' }}
        aria-hidden="true"
      />
      <select value={valor || ''} onChange={(e) => onChange(e.target.value || null)}>
        {rotuloTodas && <option value="">{rotuloTodas}</option>}
        {agendas.map((cal) => (
          <option key={cal.id} value={cal.id}>
            {nomeDa(cal)}
          </option>
        ))}
      </select>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </label>
  )
}
