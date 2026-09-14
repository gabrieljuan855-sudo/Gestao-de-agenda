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

### 4. Publicar no Cloudflare Pages (alternativa)

Depois de vincular este repositório a um projeto no Cloudflare Pages:

1. Em **Build settings**, configure:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
2. Cada push na branch escolhida (ex: `main`) dispara um novo deploy
   automático.
3. Pegue a URL gerada pelo Cloudflare Pages (ex:
   `https://seu-projeto.pages.dev`) e adicione-a nas "Origens JavaScript
   autorizadas" da credencial OAuth no Google Cloud Console — sem isso o
   login com Google não funciona no domínio publicado.

## Convenção de dados

Para guardar a prioridade de cada tarefa sem precisar de banco de dados
próprio, o app grava uma tag no início da nota da tarefa no Google Tasks, por
exemplo: `[urgente] texto da nota`. Isso é só uma convenção interna — a nota
continua legível e editável normalmente no app do Google Tasks.

## Próximos passos sugeridos

- Indicador de "carga do dia" mais detalhado na visão de mês
- Bloco recorrente protegido para tarefas administrativas
- Resumo semanal de tempo gasto por prioridade
