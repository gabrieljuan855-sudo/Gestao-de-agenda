// O servidor MCP do conector: o nome, as instruções do método e cada
// ferramenta com o esquema de entrada. O que cada uma faz mora em
// ferramentas.js; aqui fica só o contrato com o Claude.
//
// As descrições são escritas para o modelo, não para gente: é por elas que
// ele decide qual ferramenta chamar, então cada uma diz *quando* usar, e não
// só o que faz.

import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { criarApiDeTarefas } from '../../src/lib/googleTarefas.js'
import { criarApiDaAgenda } from '../../src/lib/googleAgenda.js'
import { criarArmazemNoDrive } from '../../src/lib/driveArquivos.js'
import { PRIORITIES } from '../../src/lib/priority.js'
import { criarRequest, traduzirErro } from './google.js'
import * as f from './ferramentas.js'

export const INSTRUCOES = `Segundo Cérebro é o sistema pessoal de tarefas e agenda desta pessoa, organizado pelo método GTD (David Allen), sobre o Google Tasks, o Google Calendar e anotações no Google Drive. Tudo o que você grava aparece no app dela.

Como o método se organiza:
- Entrada: o que foi capturado e ainda não foi decidido. Capturar não exige decidir nada.
- Próximas ações: o que ela mesma faz, assim que der. Cada uma é uma ação física e concreta, começando por verbo ("Ligar para a escola sobre a vaga do João").
- Aguardando: o que depende de outra pessoa (~quem, e desde quando).
- Algum dia: faria sentido um dia, sem prazo.
- Contexto (@): onde/como se faz (@ligar, @computador, @rua). Projeto (#): o resultado maior a que a tarefa pertence; o id do projeto é a etiqueta.
- Esclarecer um item da Entrada = mover com atualizar_tarefa para Próximas ações, Aguardando ou Algum dia (reescrevendo o título como ação), agendar com criar_evento, ou guardar como nota.

Como agir:
- Antes de responder sobre as demandas, o dia ou a semana dela ("como estou?", "o que tenho pra hoje?"), chame visao_geral.
- Quando ela disser "anota aí", "lembra de", "preciso...", use capturar com o texto como ela disse, sem decidir lista, prazo ou prioridade.
- Informação para guardar (não uma ação) vira nota: criar_nota, ou atualizar_nota com modo "acrescentar" para somar a uma nota existente.

As anotações são também uma base de conhecimento, no estilo do Obsidian:
- [[Título de outra nota]] dentro do texto liga as notas; cada nota sabe quem a cita (ler_nota mostra). Ao escrever, ligue a notas que já existem (procure antes com buscar_notas) e use o título exato delas.
- Quando a pessoa trouxer um material (PDF, artigo, link, transcrição, reunião) e pedir para guardar, use importar_fonte: um resumo da fonte e as ideias principais, cada uma como uma nota curta com título claro, ligadas entre si e às notas existentes. Registre a fonte (título, link, autor, data) e não invente nada que não esteja no material.
- Para responder a partir das notas: chame buscar_notas com as palavras-chave da pergunta, incluindo sinônimos e siglas por extenso e abreviadas (ex.: "PSR população rua editais recursos"); se não vier nada, tente outras palavras antes de dizer que não há. Leia com ler_nota as mais relevantes e as ligadas a elas, responda só com o que está nas notas e diga de qual nota ([[título]]) veio cada coisa. O que não estiver nas notas, diga que não está.
- Se a pessoa pedir para guardar a resposta, use guardar_resposta com os ids das notas em que ela se baseou.
- saude_das_notas aponta links quebrados, notas soltas e títulos repetidos.
- Use os ids que as ferramentas devolvem; não invente ids, nomes de projeto ou datas. Datas sempre em AAAA-MM-DD, horários em HH:MM, fuso de Brasília.
- Não há ferramenta de excluir: para descartar, sugira que ela faça no app.`

const DATA = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD.')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Data inexistente.')
const HORA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h).')
const TEXTO_CURTO = (max) => z.string().trim().min(1).max(max)
const LISTA = z.enum(['entrada', 'proximas', 'aguardando', 'algum_dia'])
const PRIORIDADE = z.enum(PRIORITIES.map((p) => p.id))
const ID = z.string().trim().min(1).max(300)

const FONTE = z.object({
  titulo: TEXTO_CURTO(300).describe('Título do material (artigo, livro, PDF, reunião).'),
  url: z.string().trim().max(2000).optional().describe('Link, se houver.'),
  autor: z.string().trim().max(200).optional(),
  data: DATA.optional().describe('Data do material, se souber.'),
})

const SO_LEITURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const ESCRITA = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }

export const ESQUEMAS = {
  visao_geral: z.object({}),
  listar_tarefas: z.object({
    lista: z.enum(['entrada', 'proximas', 'aguardando', 'algum_dia', 'todas']).default('todas').describe('Qual lista; "todas" junta as pendentes de todas as listas.'),
    contexto: TEXTO_CURTO(40).optional().describe('Só deste contexto, sem @ (ex.: ligar).'),
    projeto: TEXTO_CURTO(80).optional().describe('Só deste projeto (id/etiqueta, sem #).'),
    atrasadas: z.boolean().optional().describe('Só as com prazo vencido.'),
    cabe_em_minutos: z.number().int().min(1).max(600).optional().describe('Só o que cabe nesse tempo pela estimativa (tarefa sem estimativa também entra).'),
    limite: z.number().int().min(1).max(100).default(30),
  }),
  agenda: z.object({
    de: DATA.optional().describe('Primeiro dia (padrão: hoje).'),
    ate: DATA.optional().describe('Último dia, inclusive (padrão: o mesmo de "de"). No máximo 31 dias.'),
    vaos: z.boolean().default(true).describe('Mostrar os vãos livres dentro do expediente.'),
  }),
  listar_projetos: z.object({
    situacao: z.enum(['ativo', 'pausado', 'concluido', 'todos']).default('ativo'),
  }),
  ver_projeto: z.object({ projeto: TEXTO_CURTO(120).describe('Id do projeto (a etiqueta) ou o nome.') }),
  buscar_notas: z.object({
    texto: TEXTO_CURTO(200).describe('Palavras-chave (não precisa ser frase exata): cada palavra conta sozinha, sem diferença de acento, maiúscula ou plural. Inclua sinônimos e siglas.'),
    projeto: TEXTO_CURTO(80).optional(),
    limite: z.number().int().min(1).max(50).default(10),
  }),
  ler_nota: z.object({ id: ID }),
  capturar: z.object({ texto: TEXTO_CURTO(1000).describe('O que a pessoa disse, do jeito que disse.') }),
  criar_tarefa: z.object({
    titulo: TEXTO_CURTO(300).describe('A ação concreta, começando por verbo.'),
    lista: LISTA.default('proximas'),
    contexto: TEXTO_CURTO(40).optional().describe('Sem @ (ex.: computador).'),
    projeto: TEXTO_CURTO(80).optional().describe('Id/etiqueta do projeto, sem #.'),
    prazo: DATA.optional(),
    prioridade: PRIORIDADE.optional().describe('Padrão: media.'),
    duracao_min: z.number().int().min(1).max(600).optional().describe('Estimativa em minutos.'),
    aguardando_quem: TEXTO_CURTO(80).optional().describe('De quem se espera (obrigatório para a lista aguardando).'),
    notas: z.string().max(4000).optional().describe('Texto livre de apoio.'),
  }),
  atualizar_tarefa: z.object({
    id: ID,
    titulo: TEXTO_CURTO(300).optional(),
    lista: LISTA.optional().describe('Mover para esta lista (é assim que se esclarece um item da Entrada).'),
    contexto: z.string().trim().max(40).nullable().optional().describe('null ou "" apaga.'),
    projeto: z.string().trim().max(80).nullable().optional().describe('null ou "" tira do projeto.'),
    prazo: DATA.nullable().optional().describe('null apaga o prazo.'),
    prioridade: PRIORIDADE.optional(),
    duracao_min: z.number().int().min(1).max(600).nullable().optional(),
    aguardando_quem: z.string().trim().max(80).nullable().optional().describe('null encerra a espera. Sair de Aguardando já encerra sozinho.'),
    notas: z.string().max(4000).optional().describe('Substitui o texto livre da tarefa.'),
  }),
  concluir_tarefa: z.object({ id: ID }),
  criar_evento: z.object({
    titulo: TEXTO_CURTO(300),
    data: DATA,
    inicio: HORA.optional().describe('Sem início, o compromisso é de dia inteiro.'),
    fim: HORA.optional(),
    duracao_min: z.number().int().min(5).max(1440).optional().describe('Usado quando não há "fim" (padrão: 60).'),
    dia_inteiro: z.boolean().optional(),
    data_fim: DATA.optional().describe('Último dia, para compromisso de dia inteiro de vários dias.'),
    local: z.string().trim().max(300).optional(),
    descricao: z.string().max(4000).optional(),
    agenda: TEXTO_CURTO(120).optional().describe('Nome da agenda (padrão: a principal).'),
    projeto: TEXTO_CURTO(80).optional().describe('Liga o compromisso a um projeto (id/etiqueta).'),
  }),
  criar_nota: z.object({
    titulo: z.string().trim().max(200).optional(),
    texto: z.string().min(1).max(20000).describe('Pode ligar a outras notas com [[Título da nota]].'),
    projeto: TEXTO_CURTO(80).optional(),
    fontes: z.array(FONTE).max(10).optional().describe('De onde veio o que a nota diz.'),
  }),
  atualizar_nota: z.object({
    id: ID,
    titulo: z.string().trim().max(200).optional(),
    texto: z.string().min(1).max(20000).optional(),
    modo: z.enum(['acrescentar', 'substituir']).default('acrescentar').describe('"acrescentar" soma o texto ao fim sem apagar nada; "substituir" troca o texto inteiro.'),
    projeto: z.string().trim().max(80).nullable().optional().describe('null ou "" tira do projeto.'),
    fontes: z.array(FONTE).max(10).optional().describe('Fontes a somar às que a nota já tem.'),
  }),
  importar_fonte: z.object({
    fonte: FONTE,
    resumo: z.string().trim().min(1).max(20000).describe('Resumo da fonte: o que é e o que diz de mais importante.'),
    notas: z
      .array(
        z.object({
          titulo: TEXTO_CURTO(200).describe('Título curto e claro da ideia (é por ele que as notas se ligam).'),
          texto: z.string().trim().min(1).max(20000).describe('A ideia, com [[links]] para outras notas quando fizer sentido.'),
        })
      )
      .min(1)
      .max(20),
    projeto: TEXTO_CURTO(80).optional().describe('Projeto a que tudo isso pertence (id/etiqueta).'),
  }),
  saude_das_notas: z.object({}),
  guardar_resposta: z.object({
    titulo: TEXTO_CURTO(200).describe('Título claro do que a resposta responde (ex.: "Editais abertos para PSR").'),
    resposta: z.string().trim().min(1).max(20000).describe('A resposta como foi dada à pessoa, com [[links]] quando citar notas.'),
    baseada_em: z.array(ID).max(30).default([]).describe('Ids das notas em que a resposta se baseou (de buscar_notas/ler_nota).'),
    projeto: TEXTO_CURTO(80).optional().describe('Projeto a que a resposta pertence (id/etiqueta).'),
  }),
  criar_projeto: z.object({
    nome: TEXTO_CURTO(120),
    resultado: z.string().trim().max(500).optional().describe('Como se sabe que terminou (ou o propósito, se for rotina).'),
    tipo: z.enum(['projeto', 'rotina']).default('projeto'),
    prazo: DATA.optional(),
    situacao: z.enum(['ativo', 'pausado', 'concluido']).default('ativo'),
  }),
  atualizar_projeto: z.object({
    projeto: TEXTO_CURTO(120).describe('Id do projeto (a etiqueta) ou o nome.'),
    nome: TEXTO_CURTO(120).optional(),
    resultado: z.string().trim().max(500).optional(),
    tipo: z.enum(['projeto', 'rotina']).optional(),
    prazo: DATA.nullable().optional(),
    situacao: z.enum(['ativo', 'pausado', 'concluido']).optional(),
  }),
}

const FERRAMENTAS = [
  {
    nome: 'visao_geral',
    titulo: 'Visão geral',
    descricao:
      'O painel do momento: quantos itens há na Entrada, próximas ações por prioridade, tarefas atrasadas, o que está aguardando alguém há mais de 7 dias, projetos ativos sem próxima ação e os compromissos de hoje e amanhã. Chame primeiro sempre que a pessoa perguntar como está, o que tem para hoje, o que fazer agora ou pedir um resumo das demandas.',
    leitura: true,
    executar: f.visaoGeral,
  },
  {
    nome: 'listar_tarefas',
    titulo: 'Listar tarefas',
    descricao:
      'Lista tarefas pendentes, por prioridade e prazo, com filtros por lista (entrada, proximas, aguardando, algum_dia ou todas), contexto, projeto, só atrasadas, ou só o que cabe em X minutos. Devolve o id de cada uma, que as ferramentas de escrita usam.',
    leitura: true,
    executar: f.listarTarefas,
  },
  {
    nome: 'agenda',
    titulo: 'Agenda',
    descricao:
      'Os compromissos de todas as agendas marcadas, entre duas datas (padrão: hoje), dia a dia, com os vãos livres dentro do horário de trabalho. Use para "o que tenho amanhã?", "quando tenho tempo livre esta semana?" ou antes de propor um horário.',
    leitura: true,
    executar: f.agenda,
  },
  {
    nome: 'listar_projetos',
    titulo: 'Listar projetos',
    descricao:
      'Os projetos e rotinas, com situação, tarefas pendentes, atrasadas, a próxima ação e o aviso de projeto sem próxima ação. Inclui etiquetas usadas em tarefas que ainda não têm ficha.',
    leitura: true,
    executar: f.listarProjetosTexto,
  },
  {
    nome: 'ver_projeto',
    titulo: 'Ver projeto',
    descricao:
      'A ficha completa de um projeto (o que é, resultado esperado, situação, tipo, prazo, marcos, arquivos), com as tarefas por lista, as concluídas recentes, as anotações e os compromissos ligados a ele.',
    leitura: true,
    executar: f.verProjeto,
  },
  {
    nome: 'buscar_notas',
    titulo: 'Buscar anotações',
    descricao:
      'Busca nas anotações por palavras-chave, da mais relevante para a menos (título pesa mais; palavra rara pesa mais que comum; sem diferença de acento, maiúscula ou plural), opcionalmente só de um projeto. Devolve trecho, id e as notas ligadas a cada resultado; use ler_nota para o texto inteiro. Use antes de responder qualquer pergunta sobre o que a pessoa já anotou.',
    leitura: true,
    executar: f.buscarNotas,
  },
  {
    nome: 'ler_nota',
    titulo: 'Ler anotação',
    descricao: 'O texto completo de uma anotação, pelo id (de buscar_notas ou ver_projeto), com as fontes, as notas a que ela liga e as que a citam.',
    leitura: true,
    executar: f.lerNota,
  },
  {
    nome: 'capturar',
    titulo: 'Capturar na Entrada',
    descricao:
      'Guarda um texto cru na Entrada, sem decidir nada. É a ferramenta padrão quando a pessoa disser "anota aí", "lembra de", "preciso...", "não posso esquecer de...". Use o texto como ela disse; esclarecer fica para depois.',
    leitura: false,
    executar: f.capturar,
  },
  {
    nome: 'criar_tarefa',
    titulo: 'Criar tarefa',
    descricao:
      'Cria uma tarefa já esclarecida, direto na lista certa (padrão: Próximas ações), com contexto, projeto, prazo, prioridade, estimativa em minutos e, para Aguardando, de quem se espera. Use quando a pessoa já disse o que é; na dúvida, prefira capturar.',
    leitura: false,
    executar: f.criarTarefa,
  },
  {
    nome: 'atualizar_tarefa',
    titulo: 'Atualizar tarefa',
    descricao:
      'Muda título, contexto, projeto, prazo, prioridade, estimativa, de quem se espera ou o texto livre de uma tarefa, e move de lista. Mover um item da Entrada para proximas, aguardando ou algum_dia é esclarecê-lo; ao sair de Aguardando, a espera se encerra.',
    leitura: false,
    executar: f.atualizarTarefa,
  },
  {
    nome: 'concluir_tarefa',
    titulo: 'Concluir tarefa',
    descricao: 'Marca uma tarefa como concluída (e registra a conclusão na agenda, como o app faz).',
    leitura: false,
    executar: f.concluirTarefa,
  },
  {
    nome: 'criar_evento',
    titulo: 'Criar compromisso',
    descricao:
      'Cria um compromisso no Google Calendar, com hora (início e fim, ou duração) ou de dia inteiro, numa agenda escolhida pelo nome, opcionalmente ligado a um projeto. Use para o que tem dia e hora marcados.',
    leitura: false,
    executar: f.criarEvento,
  },
  {
    nome: 'criar_nota',
    titulo: 'Criar anotação',
    descricao:
      'Cria uma anotação (informação para guardar, não uma ação), opcionalmente dentro de um projeto e com a fonte de onde veio. O texto pode ligar a outras notas com [[Título da nota]]. Antes, veja com buscar_notas se já não existe uma nota sobre o mesmo assunto para acrescentar. Para um material inteiro (PDF, artigo), prefira importar_fonte.',
    leitura: false,
    executar: f.criarNota,
  },
  {
    nome: 'atualizar_nota',
    titulo: 'Atualizar anotação',
    descricao:
      'Muda uma anotação existente. Com modo "acrescentar" (padrão), o texto novo entra no fim sem apagar nada — é o jeito de ir somando informações a uma nota. "substituir" troca o texto inteiro. Também muda título e projeto; ao trocar o título, os [[links]] das outras notas para ela são atualizados juntos.',
    leitura: false,
    executar: f.atualizarNota,
  },
  {
    nome: 'importar_fonte',
    titulo: 'Importar fonte',
    descricao:
      'Transforma um material que a pessoa trouxe (PDF anexado, artigo, link, transcrição, anotações de reunião) em conhecimento guardado: uma nota da fonte com o resumo e uma nota por ideia principal, ligadas por [[título]] e com a fonte registrada em cada uma. Ideia com o mesmo título de uma nota existente é somada a ela, sem duplicar. Antes, use buscar_notas para achar notas existentes e ligar as novas a elas.',
    leitura: false,
    executar: f.importarFonte,
  },
  {
    nome: 'guardar_resposta',
    titulo: 'Guardar resposta',
    descricao:
      'Guarda como anotação uma resposta que você deu a partir das notas, quando a pessoa pedir ("guarda isso", "salva essa resposta"), ligada por [[título]] às notas em que se baseou (passe os ids). Se já existir nota com o mesmo título, a resposta é somada a ela com a data. Não use sem a pessoa pedir.',
    leitura: false,
    executar: f.guardarResposta,
  },
  {
    nome: 'saude_das_notas',
    titulo: 'Revisar anotações',
    descricao:
      'Revisão de saúde da base de anotações: links [[...]] para notas que não existem, notas soltas (sem links, sem quem as cite e fora de projeto), títulos repetidos e notas vazias. Use quando a pessoa pedir para organizar ou revisar as anotações.',
    leitura: true,
    executar: f.saudeDasNotasTexto,
  },
  {
    nome: 'criar_projeto',
    titulo: 'Criar projeto',
    descricao:
      'Cria a ficha de um projeto (nome, resultado esperado, tipo projeto ou rotina, prazo, situação). O id devolvido é a etiqueta que liga tarefas, notas e compromissos a ele.',
    leitura: false,
    executar: f.criarProjeto,
  },
  {
    nome: 'atualizar_projeto',
    titulo: 'Atualizar projeto',
    descricao:
      'Muda a ficha de um projeto: nome, resultado esperado, tipo, prazo ou situação (ativo, pausado, concluido). Se o projeto só existia como etiqueta, cria a ficha.',
    leitura: false,
    executar: f.atualizarProjeto,
  },
]

export const NOMES_DAS_FERRAMENTAS = FERRAMENTAS.map((x) => x.nome)

// As APIs de src/lib/ com o `request` do conector.
export function montarApi(env, props) {
  const request = criarRequest(env, props)
  return {
    tarefas: criarApiDeTarefas(request),
    agenda: criarApiDaAgenda(request),
    drive: criarArmazemNoDrive(request),
  }
}

// O que uma ferramenta devolve: o texto pronto, ou o erro já explicado. Erro
// de uso volta como está (o Claude corrige o pedido); erro do Google passa
// por traduzirErro, que diz o que fazer.
export async function executarFerramenta(nome, args, { api, agora = new Date() }) {
  const ferramenta = FERRAMENTAS.find((x) => x.nome === nome)
  try {
    const texto = await ferramenta.executar(api, agora, args, { traduzirErro })
    return { content: [{ type: 'text', text: texto }] }
  } catch (err) {
    const texto = err instanceof f.ErroDeUso ? err.message : traduzirErro(err)
    if (!(err instanceof f.ErroDeUso)) console.warn('conector', nome, err?.status || '', err?.message)
    return { isError: true, content: [{ type: 'text', text: texto }] }
  }
}

// Um servidor por requisição (o handler do MCP é sem estado). `props` são as
// da concessão OAuth: o e-mail e o refresh token do Google.
export function criarServidor(env, props, { agora = () => new Date(), api = null } = {}) {
  const server = new McpServer({ name: 'segundo-cerebro', title: 'Segundo Cérebro', version: '1.0.0' }, { instructions: INSTRUCOES })
  for (const x of FERRAMENTAS) {
    server.registerTool(
      x.nome,
      {
        title: x.titulo,
        description: x.descricao,
        inputSchema: ESQUEMAS[x.nome],
        annotations: { title: x.titulo, ...(x.leitura ? SO_LEITURA : ESCRITA) },
      },
      async (args) => executarFerramenta(x.nome, args, { api: api || montarApi(env, props), agora: agora() })
    )
  }
  return server
}
