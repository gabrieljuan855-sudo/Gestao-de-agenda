# Gestão de agenda

Site pessoal para gerenciar demandas, tarefas e compromissos usando o **Google
Calendar** e o **Google Tasks** como base de dados — sem banco de dados próprio,
sem backend. Tudo roda no navegador e fala direto com as APIs do Google.

## Funcionalidades

- **Adição rápida inteligente**: digite em linguagem natural (ex: "reunião
  quarta 14h" ou "ligar pra escola até sexta") e o app decide sozinho se vira
  um evento no Calendar ou uma tarefa no Tasks, e sugere a prioridade.
- **Backlog priorizado**: tarefas organizadas por urgente / importante / pode
  esperar, com aviso quando uma tarefa fica muito tempo parada.
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
   "Externo" e adicione seu próprio e-mail como usuário de teste (suficiente
   para uso pessoal).
4. Em **APIs e serviços > Credenciais**, crie uma credencial do tipo
   **ID do cliente OAuth**, tipo de aplicativo **Aplicativo da Web**.
   - Em "Origens JavaScript autorizadas", adicione o endereço onde o site vai
     rodar (ex: `http://localhost:5173` para testar local, e o endereço do
     GitHub Pages depois de publicado).
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

### 3. Publicar (opcional)

O repositório já inclui um workflow (`.github/workflows/deploy.yml`) que builda
e publica o site no GitHub Pages automaticamente a cada push na branch `main`.
Para ativar:

1. Em **Settings > Pages** do repositório, em "Source", selecione
   **GitHub Actions**.
2. Faça um push (ou merge) na branch `main` — o workflow builda o projeto e
   publica o conteúdo de `dist/`.
3. Pegue a URL final mostrada em **Settings > Pages** e adicione-a nas
   "Origens JavaScript autorizadas" da credencial OAuth no Google Cloud
   Console.

Para publicar manualmente em vez disso, basta rodar `npm run build` e subir o
conteúdo da pasta `dist/` onde preferir.

### 3.5. Login que não expira (recomendado, obrigatório no atalho do celular)

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

### 4. Publicar no Cloudflare Workers (alternativa)

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

## Convenção de dados

Para guardar a prioridade de cada tarefa sem precisar de banco de dados
próprio, o app grava uma tag no início da nota da tarefa no Google Tasks, por
exemplo: `[urgente] texto da nota`. Isso é só uma convenção interna — a nota
continua legível e editável normalmente no app do Google Tasks.

## Próximos passos sugeridos

- Indicador de "carga do dia" mais detalhado na visão de mês
- Bloco recorrente protegido para tarefas administrativas
- Resumo semanal de tempo gasto por prioridade
