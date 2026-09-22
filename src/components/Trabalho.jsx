// O lugar único onde o trabalho mora.
//
// Antes cada estado do método tinha um botão no trilho: Entrada, Agora,
// Aguardando e Revisão viraram quatro ferramentas ao lado de Criar, Buscar,
// Pomodoro e Anotações — oito no total, e o trilho não é um lugar, é uma
// caixa de ferramentas. Só que estes quatro não são ferramentas: são o
// mesmo material (as suas tarefas) em momentos diferentes do método.
//
// Abas, e não pílulas: é o componente que o MD3 reserva para navegar entre
// visões irmãs do mesmo conteúdo, e o indicador de 3dp colado embaixo é
// justamente o que amarra a aba ao que está sendo mostrado.
export default function Trabalho({ abas, abaAtiva, onAbaChange }) {
  const atual = abas.find((a) => a.id === abaAtiva) || abas[0]

  return (
    <div className="card trabalho">
      <div className="tabs" role="tablist" aria-label="Trabalho">
        {abas.map((aba) => (
          <button
            key={aba.id}
            type="button"
            role="tab"
            id={`aba-${aba.id}`}
            aria-selected={atual.id === aba.id}
            aria-controls={`painel-${aba.id}`}
            aria-label={aba.label}
            title={aba.label}
            className={`tab${atual.id === aba.id ? ' is-ativa' : ''}`}
            onClick={() => onAbaChange(aba.id)}
          >
            {aba.icon}
            {aba.badge > 0 && <span className="tab-badge">{aba.badge}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`painel-${atual.id}`} aria-labelledby={`aba-${atual.id}`}>
        {atual.render()}
      </div>
    </div>
  )
}
