# Gestão de agenda

Site pessoal para gerenciar demandas, tarefas e compromissos usando o **Google
Calendar** e o **Google Tasks** como base de dados — sem banco de dados próprio.
A tela roda no navegador e fala direto com as APIs do Google; o Worker que
serve o site cuida apenas do login e da interpretação por IA, que precisam de
segredos e por isso não podem ficar no navegador.

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
  prioridade.
- **Aguardando & Algum dia**: o que depende de outra pessoa (com quem e desde
  quando, destacado depois de uma semana de espera) e o que não é para agora,
  cada um na sua tela, com um botão para reativar quando deixar de fazer
  sentido esperar.
- **Projeto sem próxima ação**: um aviso quando alguma etiqueta de projeto
  (`#caso-silva`) não tem nenhuma tarefa em Próximas ações — o sinal clássico
  de um projeto que parou de andar sem ninguém perceber.
- **Agora**: a pergunta de engajamento do GTD — dado o contexto e o tempo que
  sobra até o próximo compromisso, qual é a melhor próxima ação disponível?
  Filtra por contexto e (opcionalmente) só o que cabe no vão livre real, e
  deixa agendar ali mesmo um bloco no Calendar para a tarefa escolhida
  (*time-blocking*). O horário de trabalho que decide o que é "vão livre" é
  configurável nesta tela, por dia da semana.
- **Tarefas na visão de Dia**: o que vence hoje aparece direto na tela onde
  você já está olhando o dia, não só na lista lateral.
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
