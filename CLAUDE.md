# Segundo Cérebro

App pessoal de agenda e tarefas organizado pelo método GTD, ligado ao Google
Calendar e ao Google Tasks, com anotações sincronizadas pelo Drive e recursos
de IA pelo Gemini.

## Como trabalhar aqui

### Implantar sempre

Terminou e validou, vai para o `main`. Sem exceção.

- **Nunca** deixar PR em draft esperando o dono aprovar, testar ou olhar.
- **Nunca** parar para pedir permissão de publicar. Isso vale inclusive para
  mudanças em login, em sincronização e em qualquer coisa que mexa com dados —
  ele decidiu assim explicitamente. O histórico do Git é a rede de proteção.
- O PR é **passagem, não portão**: o ambiente exige abrir um para a branch
  enviada, então abre, mescla e segue.

Mesclar no `main` publica em produção na hora, pela integração da Cloudflare
com o Git. É esse o objetivo.

### O único freio: teste quebrado não sobe

Antes de mesclar, sempre:

```
npm run build      # tem que sair limpo
npx vitest run     # tem que passar inteiro
```

Isso não é pedir permissão — é não publicar o que já se sabe que está errado.
Se quebrar, conserta e mescla. Nunca desativar ou pular um teste para passar.

### O que não deu para testar, se diz

Vários fluxos exigem a conta do Google conectada e não rodam no ambiente de
desenvolvimento. Nesses casos: entrega, publica e **avisa no fim o que ficou
sem verificação** — em vez de segurar a entrega por causa disso.

### Agrupar, não espalhar

Pedidos relacionados viram uma mudança só. Uma branch por ajuste pequeno gera
uma pilha de branches que só atrapalha.

## Estrutura

- `src/` — React + Vite. Componentes em `src/components/`, lógica e hooks em
  `src/lib/`.
- `worker/` — o Cloudflare Worker. Serve o site estático e hospeda as rotas de
  IA (`/api/esclarecer`, `/api/briefing`, `/api/analyze-note`,
  `/api/search-notes`). A chave do Gemini é
  segredo do Worker e **nunca** chega ao navegador — é por isso que essa parte
  roda no servidor.
- `worker/conector/` — o conector do Claude: servidor MCP remoto em `/mcp`
  (`createMcpHandler` do Agents SDK, sem estado) atrás do `OAuthProvider` da
  Cloudflare, com login pelo Google (mesmo client ID e escopos do app) e só
  para `ALLOWED_EMAIL`. As rotas dele (`/mcp`, `/authorize`, `/token`,
  `/register`, `/conector/decidir`, `/conector/callback`, `/.well-known/oauth-*`) são as únicas que
  passam pelo provider; o resto do Worker segue como antes.
  `ferramentas.js` faz o trabalho, `servidor.js` descreve as ferramentas para
  o modelo, `oauth.js` cuida do login e `google.js`, do token do Google.
- **Regra do conector: mesma lógica do app, sem duplicar.** Ele importa as
  funções de `src/lib/`; o acesso ao Google que os dois lados usam fica em
  módulos que recebem o `request` de fora (`googleTarefas.js`,
  `googleAgenda.js`, `driveArquivos.js`). Se algo de `src/lib/` precisar do
  navegador, separe a parte pura em vez de copiar código para o Worker.
- Anotações são uma base de conhecimento: links `[[título]]` e fontes
  (`notasLinks.js`, campo `fontes` em `notasFormato.js`). O link aponta para o
  título, não para o id, e a regra de resolução é uma só para o app e o
  conector.
- O app e o conector gravam nos mesmos arquivos do Drive: toda gravação é
  ler → mesclar → gravar (`mesclarParaGravar` em `notesMerge.js`), nunca a
  lista local por cima.
- Testes ficam ao lado do que testam (`src/lib/x.test.js`), em vitest. A regra
  na prática: lógica pura tem teste; componente React, não. Os do conector
  rodam contra um Google falso em memória (`worker/teste/googleFalso.js`) e um
  KV em memória, passando pelas funções reais de `src/lib/`.

## Design: Material Design 3 é o ponto de partida

Toda decisão de interface começa perguntando **qual componente do MD3 resolve
isso**, antes de inventar qualquer coisa. Usar o componente errado é o erro mais
caro, porque ele comunica a coisa errada mesmo bem pintado:

- **Abas** (navegar entre itens abertos, estilo navegador) → *primary tabs*:
  rótulo, altura de 48dp, e o **indicador ativo** — uma barra arredondada de 3dp
  colada embaixo da aba ativa, que é o que amarra a aba ao conteúdo. Nunca pílula.
- **Chips** → filtro, entrada e sugestão. Não servem para navegar; foi
  exatamente esse engano que fez a barra de abas parecer estranha.
- **Botões** → FAB para a ação principal da tela, *filled* para confirmar,
  *text* para a saída secundária.
- **Superfícies** → o conteúdo longo pede largura de verdade (*side sheet* larga
  ou diálogo de tela cheia), não o painel estreito de uma ferramenta rápida.
- **Estados** → hover, foco e pressionado existem no MD3 e não são enfeite; é
  por eles que se sabe que algo é clicável.

Os papéis de cor e as formas já estão em `src/index.css` como tokens. Usar os
tokens, nunca valores soltos.

## Convenções

- **Tudo em português**: nomes, comentários, mensagens de commit, texto de tela.
- **Comentário explica o porquê**, não o quê. O valor está em registrar a
  decisão e o problema real que ela resolveu — o código já diz o que faz.
- Reaproveitar os tokens de design que já existem em `src/index.css`
  (`--surface-2`, `--accent`, `--border`, `--shape-sm`...) em vez de inventar
  valores novos.
- Resposta de IA nunca é confiável: cada campo é validado no Worker antes de
  virar ação. Ver `normalizeAgent` em `worker/index.js`.
