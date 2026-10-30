# Segundo Cérebro

Site pessoal para capturar, organizar e revisar demandas, tarefas e
compromissos pelo método GTD, usando o **Google Calendar** e o **Google
Tasks** como base de dados — sem banco de dados próprio. A tela roda no
navegador e fala direto com as APIs do Google; o Worker que serve o site
cuida apenas do login e da interpretação por IA, que precisam de segredos e
por isso não podem ficar no navegador.

## Como o app se organiza

Duas colunas e um trilho. À esquerda, **a agenda** (dia, semana ou mês). À
direita, **o painel de trabalho**, com quatro abas que são os quatro momentos
do método: *Entrada* (o que chegou e ainda não foi decidido), *Próximas* (o
que dá para fazer), *Aguardando* (o que depende de outra pessoa) e *Revisão*
(o olhar de fim de semana). No trilho, só ferramenta de verdade: capturar,
buscar, pomodoro e anotações.

A divisão que sustenta isso: **a agenda informa, o painel age**. Uma tarefa
que vence hoje aparece na visão de Dia como uma linha, para você saber que ela
existe ali no meio dos compromissos — mas os botões dela ficam num lugar só,
no painel ao lado.

## Funcionalidades

- **Captura sem atrito**: um campo e Enter. O texto cai como está na lista
  **Entrada** do Google Tasks, sem exigir que você decida na hora se aquilo é
  evento, tarefa ou qual prioridade — decidir é um segundo gesto, separado de
  guardar. Se o texto tiver dia **e** hora marcados ("reunião quarta 14h"), o
  app oferece um desvio para agendar direto no Calendar, que é o único caso em
  que a decisão não pode esperar.
- **Captura que não falha**: sem rede, o texto fica numa fila local e sobe
  sozinho quando a conexão volta.
- **Esclarecer a Entrada**: uma tela que mostra um item de cada vez e pergunta
  o que ele é. Você reescreve o título como uma ação de verdade ("Ligar para a
  escola sobre a vaga do João") e escolhe o destino: próxima ação (com
  contexto: `@ligar`, `@computador`... e, se fizer parte de um projeto, a
  etiqueta dele), aguardando alguém, agendar, algum dia, referência ou lixo.
  Sair da Entrada é o que marca o item como resolvido.
- **Próximas ações**: a lista principal, filtrável por contexto, com o prazo
  visível e a atrasada destacada — quem vence antes sobe dentro da mesma
  prioridade. Quando há um vão livre agora, ela também responde à pergunta de
  engajamento do GTD: mostra quanto tempo sobra até o próximo compromisso,
  deixa filtrar só o que cabe nesse tempo (pela estimativa de duração da
  tarefa) e agendar ali mesmo um bloco no Calendar (*time-blocking*).
- **Aguardando & Algum dia**: o que depende de outra pessoa (com quem e desde
  quando, destacado depois de uma semana de espera) e o que não é para agora,
  com um botão para reativar quando deixar de fazer sentido esperar.
- **Projeto sem próxima ação**: um aviso quando alguma etiqueta de projeto
  (`#caso-silva`) não tem nenhuma tarefa em Próximas ações — o sinal clássico
  de um projeto que parou de andar sem ninguém perceber.
- **Horário de trabalho configurável** (no cabeçalho, junto de *Agendas*): é
  ele que decide o que conta como vão livre, por dia da semana.
- **Revisão semanal**: sob demanda (com um convite às sextas) — entrada vazia,
  atrasadas, paradas, projetos sem próxima ação, quem está esperando há mais
  de uma semana, o que foi concluído e quanto tempo de foco a semana teve.
  Todos os números saem calculados sem IA nenhuma; a única chamada de IA da
  tela é um comentário de até 60 palavras por cima deles, uma vez por revisão.
  Substitui os 3 briefings automáticos por dia que o app tinha antes.
- **Cronômetro de foco (Pomodoro 25/5)**: ao focar numa tarefa, o app cria
  automaticamente um evento real no Calendar com o tempo gasto.
- **Visões de dia, semana e mês**: dia mostra a linha do tempo; semana mostra
  a carga de cada dia (livre/médio/lotado); mês mostra uma visão geral.

## Passo a passo para configurar

### 1. Criar credenciais no Google Cloud

1. Acesse [console.cloud.google.com](https://console.cloud.google.com/) e crie
   um projeto (ou use um existente).
2. Em **APIs e serviços > Biblioteca**, ative:
   - Google Calendar API
   - Google Tasks API
3. Em **APIs e serviços > Tela de consentimento OAuth**, configure como
   "Externo". Para uso diário, publique em **Em produção** (ver passo 4): em
   modo de teste o Google descarta o refresh token a cada 7 dias.
4. Em **APIs e serviços > Credenciais**, crie uma credencial do tipo
   **ID do cliente OAuth**, tipo de aplicativo **Aplicativo da Web**.
   - Em "Origens JavaScript autorizadas", adicione o endereço onde o site vai
     rodar (ex: `http://localhost:5173` para testar local, e o endereço do
     Worker depois de publicado).
5. Copie o **Client ID** gerado.

### 2. Configurar o projeto

```bash
npm install
cp .env.example .env
# edite o .env e cole o Client ID copiado acima
npm run dev
```

Abra o endereço mostrado no terminal (normalmente `http://localhost:5173`) e
clique em "Entrar com o Google".

### 3. Publicar no Cloudflare Workers

O app **não roda em hospedagem estática**. O login (`/api/auth/*`) e a
interpretação por IA (`/api/parse`) são rotas do próprio Worker, então servir
só o conteúdo de `dist/` em algum lugar resultaria num site sem login. Era por
isso que existia um workflow de GitHub Pages aqui; ele foi removido.

O `wrangler.toml` na raiz já traz o necessário: ele roda `npm run build` e
serve o conteúdo de `dist/` como assets estáticos. Depois de vincular o
repositório ao projeto no Cloudflare:

1. Em **Configurações > Build**:
   - **Comando da build**: deixe vazio — quem roda o build é o `[build]` do
     `wrangler.toml`.
   - **Comando de implantação**: `npx wrangler deploy`.

   Atenção ao `npx wrangler versions upload`: ele **sobe uma versão sem
   publicar**, então o site continua servindo a versão antiga e os deploys
   parecem bem-sucedidos sem nunca entrar no ar.

2. Em **Controle da ramificação > Ramificação de produção**: use `main`.
   Se apontar para qualquer outra branch, todo push no `main` vira build de
   *não produção*: o build passa, o painel mostra "Deployment successful",
   e mesmo assim nada chega ao site publicado.

3. Em **Variáveis e segredos**, na seção de **build** (não a de runtime, que
   fica desabilitada em Worker só de assets estáticos), defina
   `VITE_GOOGLE_CLIENT_ID` — o Vite injeta essa variável durante o build.

4. Pegue a URL gerada (ex: `https://seu-projeto.workers.dev`) e adicione-a
   nas "Origens JavaScript autorizadas" da credencial OAuth no Google Cloud
   Console — sem isso o login com Google não funciona no domínio publicado.
   Enquanto o app estiver em modo "Teste", cadastre também o seu e-mail em
   **Público-alvo > Usuários de teste**.

### 4. Login que não expira (obrigatório no atalho do celular)

Por padrão o app usa o fluxo implícito do Google: um token de uma hora,
renovado por um iframe invisível que depende do cookie de sessão do Google no
navegador. **No atalho da tela de início do iOS esse cookie não existe** — o
app instalado tem armazenamento separado do Safari —, então a renovação nunca
funciona e o login volta a cada hora.

Com os segredos abaixo configurados, quem faz o login é o Worker, pelo fluxo de
authorization code. Ele recebe um *refresh token*, que não depende de cookie
nenhum do Google, e o guarda cifrado num cookie `HttpOnly` do próprio domínio.
O app passa a pedir um token novo em `/api/auth/token` — sem iframe, sem script
de terceiro, e funcionando no atalho.

Sem esses segredos o Worker responde `501` e o app volta sozinho para o fluxo
antigo, então dá para configurar na ordem que quiser.

**1. No Google Cloud Console**, na credencial OAuth (Aplicativo da Web):

- Em **URIs de redirecionamento autorizados**, adicione exatamente:
  `https://SEU-WORKER.workers.dev/api/auth/callback`
- Anote o **ID do cliente** e o **Código secreto do cliente**.

**2. Na Tela de consentimento OAuth**, mude a situação para **Em produção**.

> Enquanto o app estiver **Em teste**, o Google apaga o refresh token depois de
> **7 dias** — o login voltaria uma vez por semana em vez de uma vez por hora.
> Publicar resolve. Como os escopos de Calendar e Tasks são sensíveis, a tela
> de aviso de "app não verificado" continua aparecendo no primeiro login; é só
> seguir em "Avançado > Acessar". Para uso pessoal isso basta.

**3. No Cloudflare**, no Worker, em **Settings > Variables and Secrets**, crie
como **Secret** (não como variável de build):

| Nome | Valor |
| --- | --- |
| `GOOGLE_CLIENT_ID` | o ID do cliente do passo 1 |
| `GOOGLE_CLIENT_SECRET` | o código secreto do passo 1 |
| `SESSION_SECRET` | um texto aleatório longo, inventado por você — é a chave que cifra o cookie |
| `ALLOWED_EMAIL` | seu e-mail do Google, para nenhuma outra conta conseguir criar sessão |

Trocar o `SESSION_SECRET` invalida as sessões existentes: é assim que se
desconecta tudo de uma vez, se precisar.

Mantenha o `VITE_GOOGLE_CLIENT_ID` do passo 2 como está: ele é a rede de
segurança para o caso de o login pelo servidor sair do ar.

## Anotações como base de conhecimento

As anotações funcionam no estilo do Obsidian (e do claude-obsidian), mas dentro
do app, no celular e no computador:

- **Links entre notas:** `[[Nome da nota]]` no texto liga uma nota à outra, sem
  ligar para acento ou maiúscula. Embaixo de cada nota aparecem **Esta nota
  liga a** e **Citada por**; um link para uma nota que ainda não existe oferece
  criá-la. `[[Nota|outro texto]]` e `[[Nota#Seção]]` também apontam para "Nota".
- **Escrever ligado:** ao digitar `[[`, aparecem sugestões com os títulos das
  notas que existem, logo acima da linha; tocar completa o link.
- **Renomear sem quebrar:** trocar o título de uma nota atualiza os links das
  outras notas para ela, ao sair do campo de título (no app) ou na hora (pelo
  Claude).
- **Busca por palavras:** a busca da lista e a do Claude acham cada palavra em
  qualquer ordem, sem acento, maiúscula ou plural; a do Claude ordena pela
  relevância (BM25 — título e palavras raras pesam mais).
- **Fontes:** cada nota guarda de onde veio (título, link, autor, data).
- **Pelo Claude:** anexe um PDF ou cole um artigo e peça para guardar no
  Segundo Cérebro — `importar_fonte` cria a nota da fonte e uma nota por ideia,
  ligadas entre si e às notas que já existem (uma ideia com o título de uma
  nota existente é somada a ela). Perguntas sobre as anotações são respondidas
  a partir delas, dizendo em qual nota está cada coisa; se você pedir, a
  resposta vira nota (`guardar_resposta`), ligada às notas de onde saiu.

## Usar pelo Claude (conector MCP)

O mesmo Worker é também um **servidor MCP remoto**: adicionado como conector
personalizado no Claude (claude.ai, app de desktop e celular), ele deixa o
Claude consultar e alimentar tudo o que o app organiza — Entrada, Próximas
ações, Aguardando, Algum dia, projetos, agenda e anotações. O que o Claude grava
aparece no app, e vice-versa: as ferramentas usam as mesmas funções de
`src/lib/` (listas por nome, o bloco `[alta @contexto #projeto ~quem ...]`,
o `anotacoes.json` mesclado com o rastro de exclusões, o `projetos.json`).

### Configurar (uma vez)

**1. No Google Cloud Console**, na mesma credencial OAuth do passo 4 acima, em
**URIs de redirecionamento autorizados**, adicione:
`https://SEU-WORKER.workers.dev/conector/callback`

O conector usa **o mesmo client ID** do app de propósito: a pasta privada do
Drive onde ficam as anotações (`appDataFolder`) é por cliente OAuth. Com outro
client ID, o Claude veria uma pasta vazia.

**2. No Cloudflare**, os segredos do passo 4 (`GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`) e o **`ALLOWED_EMAIL`, que aqui é
obrigatório**: sem ele o conector recusa qualquer conta.

**3. O KV `OAUTH_KV`**, onde ficam as autorizações do conector, é criado
sozinho no deploy (o `wrangler.toml` declara o binding sem id, e o wrangler 4
provisiona um namespace chamado `gestaodeagenda-oauth-kv`). Se o log do build
avisar que o provisionamento foi pulado por falta de permissão, crie à mão:
**Storage & Databases > KV > Create**, com o nome `gestaodeagenda-oauth-kv`;
depois, no Worker, **Settings > Bindings > Add > KV namespace**, com o nome de
variável `OAUTH_KV` apontando para ele (ou cole o id no `wrangler.toml`, numa
linha `id = "..."` abaixo de `binding = "OAUTH_KV"`). Enquanto o KV não
existir, só o conector fica fora do ar; o site segue normal.

**4. No Claude**, em **Configurações > Conectores > Adicionar conector
personalizado**, cole `https://SEU-WORKER.workers.dev/mcp` (o mesmo endereço
do app, terminando em `/mcp`). Ao conectar, aparece a tela "Permitir que
Claude use o Segundo Cérebro?"; depois, o Google pede para entrar com a conta
de `ALLOWED_EMAIL`. Conectores adicionados no claude.ai aparecem também no app
do celular e no de desktop.

### O que o Claude consegue fazer

| Ferramenta | Para quê |
| --- | --- |
| `visao_geral` | O painel do momento: Entrada, próximas ações por prioridade, atrasadas, esperas de mais de 7 dias, projetos parados, hoje e amanhã |
| `listar_tarefas` | Tarefas por lista, contexto, projeto, atrasadas ou "cabe em X minutos" |
| `agenda` | Compromissos entre duas datas, com os vãos livres do expediente |
| `listar_projetos` / `ver_projeto` | Projetos, e a ficha completa com tarefas, notas e compromissos |
| `buscar_notas` / `ler_nota` | Busca por palavras nas anotações, em ordem de relevância, com as notas vizinhas; e o texto inteiro |
| `capturar` | Texto cru na Entrada, sem decidir nada |
| `criar_tarefa` / `atualizar_tarefa` / `concluir_tarefa` | Tarefas já esclarecidas, mover de lista, concluir (com o registro na agenda) |
| `criar_evento` | Compromisso no Calendar, com ou sem projeto |
| `criar_nota` / `atualizar_nota` | Anotações, com o modo "acrescentar ao fim" e as fontes |
| `importar_fonte` | Um material (PDF, artigo, link, reunião) vira a nota da fonte e uma nota por ideia, ligadas e com a fonte registrada |
| `guardar_resposta` | Uma resposta dada a partir das notas vira nota, ligada às notas de origem (só quando você pede) |
| `saude_das_notas` | Links quebrados, notas soltas, títulos repetidos e notas vazias |
| `criar_projeto` / `atualizar_projeto` | A ficha do projeto |

Não há ferramenta de excluir. Os vãos livres usam o expediente padrão do app
(seg. a qui. 8h–12h e 13h–17h30, sex. 7h30–13h30): o horário ajustado na tela
mora só no aparelho, fora do alcance do servidor.

Se o Google revogar o acesso (senha trocada, app "em teste" com o prazo de 7
dias vencido), as ferramentas respondem pedindo para reconectar: em
Configurações > Conectores, desconecte e conecte de novo.

### Testar localmente

Crie um `.dev.vars` (já está no `.gitignore`) com `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` e `ALLOWED_EMAIL`, rode
`npx wrangler dev` e aponte o MCP Inspector
(`npx @modelcontextprotocol/inspector`) para `http://localhost:8787/mcp`. Para
o login do Google funcionar localmente, a credencial precisa também de
`http://localhost:8787/conector/callback` nos URIs de redirecionamento.

## Capturar do celular sem abrir o app (iOS)

O endereço `/?capturar=TEXTO` guarda o texto na Entrada e mostra a confirmação.
É o caminho de captura rápida no iPhone, onde um PWA não aparece no
compartilhamento do sistema.

No app **Atalhos** do iPhone: novo atalho → *Pedir entrada* (texto, pergunta
"O que está na sua cabeça?") → *Abrir URL* com
`https://SEU-WORKER.workers.dev/?capturar=` + a entrada fornecida (use a ação
*Codificar URL* no texto antes de juntar, para acento e espaço não quebrarem o
endereço). Dê um nome curto ao atalho e ele passa a funcionar por voz ("Ei
Siri, anotar") e no **Toque nas costas** (Ajustes > Acessibilidade > Toque >
Toque nas costas).

## Convenção de dados

O app não tem banco próprio, então tudo mora no Google — e isso é de
propósito: o que você capturou continua existindo no app oficial do Google
Tasks, no Gmail e na Siri, mesmo que este site saia do ar.

**As listas são os estados.** Uma tarefa está em exatamente uma delas, e
mover de lista é o ato de decidir. O app cria sozinho, no primeiro login, as
que faltarem:

| Lista | O que significa |
| --- | --- |
| `Entrada` | Capturado, ainda não decidido |
| `Próximas ações` | Você que faz, assim que der |
| `Aguardando` | Depende de outra pessoa |
| `Algum dia` | Faria sentido um dia, sem prazo |

**O resto vai numa etiqueta no começo da nota da tarefa**, já que o Google
Tasks não tem campo livre para metadado (os eventos do Calendar têm; as
tarefas, não):

```
[alta @ligar #caso-silva ~ana desde:2026-09-10 min:15] texto livre da nota
```

Prioridade sem marcador, contexto com `@`, projeto com `#`, de quem se espera
com `~`, desde quando com `desde:` e a estimativa de duração (minutos, para a
tela Agora decidir o que cabe no tempo livre) com `min:`. Continua uma linha
legível no app do Google Tasks — é o motivo de não ser JSON. As notas antigas,
que só tinham `[urgente]`, seguem sendo lidas normalmente.

**Projeto não é um cadastro à parte** — é só a mesma etiqueta `#projeto`
repetida em mais de uma tarefa. O app não guarda "projetos" em lugar nenhum;
ele só conta quantas tarefas cada etiqueta tem em Próximas ações, e avisa
quando esse número cai a zero.

## Próximos passos sugeridos

- Indicador de "carga do dia" mais detalhado na visão de mês
- Bloco recorrente protegido para tarefas administrativas
- Resumo semanal de tempo gasto por prioridade
