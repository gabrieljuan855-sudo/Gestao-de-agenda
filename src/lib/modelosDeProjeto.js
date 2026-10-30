import { novoProjeto, normalizarProjeto, adicionarMarco } from './projetos.js'

// Os modelos de projeto da rotina da Proteção Social Especial: o começo que
// todo caso, POP, ofício, reunião de rede ou calamidade repete. Um modelo dá
// a ficha (tipo e resultado esperado), as primeiras próximas ações, os
// marcos e uma anotação-base com as seções de sempre.
//
// O que só se faz mais adiante vira marco, e não tarefa: dez tarefas de uma
// vez encheriam as Próximas ações de coisas que ainda não dá para fazer —
// o GTD pede só o próximo passo de cada projeto à vista. Os marcos dizem
// onde o projeto precisa chegar; a próxima ação de cada etapa é escrita
// quando a etapa chega.
//
// Os textos são ponto de partida, para ajustar aqui mesmo conforme a rotina
// mudar. Nenhum dado de pessoa entra neles.

export const MODELOS = [
  {
    id: 'caso',
    rotulo: 'Caso / Acompanhamento',
    dica: 'Acompanhamento de uma família ou pessoa: acolhida, PAF, rede, relatórios.',
    tipo: 'projeto',
    resultado: 'Caso acompanhado com PAF elaborado, encaminhamentos feitos e desligamento ou contrarreferência registrados.',
    tarefas: [
      { title: 'Ler o histórico e os documentos que chegaram com o caso', priority: 'alta' },
      { title: 'Agendar o acolhimento com a família', priority: 'alta' },
    ],
    marcos: ['Acolhimento realizado', 'PAF elaborado com a família', 'Estudo de caso com a rede', 'Relatório ao órgão demandante', 'Reavaliação do PAF', 'Desligamento ou contrarreferência'],
    nota: {
      titulo: 'Registro do caso',
      corpo: '## Demanda\nDe onde veio, quando e o que foi pedido.\n\n## Composição familiar\n\n## Rede envolvida\n- [ ] CRAS\n- [ ] Saúde\n- [ ] Educação\n- [ ] Conselho Tutelar\n- [ ] Judiciário / MP\n\n## Atendimentos\n\n## Encaminhamentos\n',
    },
  },
  {
    id: 'pop',
    rotulo: 'POP',
    dica: 'Procedimento operacional padrão: da pesquisa à publicação.',
    tipo: 'projeto',
    resultado: 'POP aprovado pela gestão, publicado e apresentado à equipe.',
    tarefas: [
      { title: 'Levantar a legislação e as normativas do tema', priority: 'media' },
      { title: 'Escrever o rascunho do POP', priority: 'media' },
    ],
    marcos: ['Rascunho pronto', 'Revisão pela equipe técnica', 'Ajustes incorporados', 'Aprovação da gestão', 'Publicação e apresentação à equipe'],
    nota: {
      titulo: 'Estrutura do POP',
      corpo: '## Objetivo\n\n## Base legal\n\n## Público\n\n## Fluxo\n1. \n\n## Responsáveis\n\n## Registros e instrumentais\n',
    },
  },
  {
    id: 'oficio',
    rotulo: 'Ofício / Documento',
    dica: 'Ofício, relatório ou parecer: redigir, assinar, enviar e acompanhar a resposta.',
    tipo: 'projeto',
    resultado: 'Documento enviado com protocolo e resposta registrada.',
    tarefas: [
      { title: 'Reunir as informações e os documentos de base', priority: 'media' },
      { title: 'Redigir o documento', priority: 'media' },
    ],
    marcos: ['Rascunho pronto', 'Revisão e assinatura', 'Enviado com protocolo', 'Resposta recebida'],
    nota: null,
  },
  {
    id: 'reuniao-rede',
    rotulo: 'Reunião de rede',
    dica: 'Reunião com a rede intersetorial: pauta, convite, ata e encaminhamentos.',
    tipo: 'projeto',
    resultado: 'Reunião realizada, com ata enviada aos participantes e encaminhamentos acompanhados.',
    tarefas: [
      { title: 'Definir a pauta e quem precisa participar', priority: 'media' },
      { title: 'Marcar data e local e enviar o convite', priority: 'media' },
    ],
    marcos: ['Convites enviados', 'Reunião realizada', 'Ata enviada aos participantes', 'Encaminhamentos verificados'],
    nota: {
      titulo: 'Pauta e ata',
      corpo: '## Pauta\n1. \n\n## Participantes\n- [ ] \n\n## Discussão\n\n## Encaminhamentos\n- [ ] O quê — quem — até quando\n',
    },
  },
  {
    id: 'calamidade',
    rotulo: 'Calamidade',
    dica: 'Resposta a enchente, vendaval ou outra emergência: levantamento, rede, benefícios e prestação de contas.',
    tipo: 'projeto',
    resultado: 'Famílias atingidas identificadas, atendidas e acompanhadas até a normalização, com relatórios e prestação de contas entregues.',
    tarefas: [
      { title: 'Levantar as famílias atingidas e as necessidades imediatas', priority: 'alta' },
      { title: 'Acionar a rede (Defesa Civil, Saúde, CRAS) e definir pontos de contato', priority: 'alta' },
      { title: 'Organizar o registro dos atendimentos e dos benefícios eventuais', priority: 'alta' },
    ],
    marcos: ['Levantamento inicial concluído', 'Abrigos e benefícios eventuais organizados', 'Relatório para a gestão', 'Acompanhamento pós-evento', 'Encerramento e prestação de contas'],
    nota: {
      titulo: 'Plano de resposta',
      corpo: '## Situação\nO que aconteceu, onde e quando.\n\n## Contatos da rede\n- Defesa Civil: \n- Saúde: \n- CRAS: \n\n## Abrigos e pontos de apoio\n\n## Benefícios eventuais\n\n## Registro diário\n',
    },
  },
]

export function acharModelo(id) {
  return MODELOS.find((m) => m.id === id) || null
}

// Tudo o que um modelo cria, pronto para gravar: a ficha (com os marcos),
// as tarefas (já com a etiqueta do projeto) e a anotação. null quando o nome
// não dá uma etiqueta ou o modelo não existe.
export function aplicarModelo(modeloId, nome, agora = new Date()) {
  const modelo = acharModelo(modeloId)
  const base = novoProjeto(nome || '', agora)
  if (!modelo || !base) return null
  let marcos = []
  // Um milissegundo de diferença entre os marcos: o id deles sai da hora, e
  // marcos com o mesmo id se confundiriam ao marcar um como feito.
  modelo.marcos.forEach((titulo, i) => {
    marcos = adicionarMarco(marcos, { titulo, data: null }, new Date(agora.getTime() + i))
  })
  // Sem data, os marcos ficam na ordem em que foram escritos (a sequência
  // do trabalho), e não em ordem alfabética.
  marcos = modelo.marcos.map((titulo) => marcos.find((m) => m.titulo === titulo)).filter(Boolean)
  const ficha = normalizarProjeto({ ...base, tipo: modelo.tipo, resultado: modelo.resultado, marcos }, agora)
  return {
    ficha,
    tarefas: modelo.tarefas.map((t) => ({ ...t, projeto: ficha.id })),
    nota: modelo.nota ? { title: `${modelo.nota.titulo} — ${ficha.nome}`, body: modelo.nota.corpo, projeto: ficha.id } : null,
  }
}
