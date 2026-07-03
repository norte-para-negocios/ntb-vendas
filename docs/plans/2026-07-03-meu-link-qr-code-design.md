# Meu Link / QR Code (painel do Lojista)

Data: 2026-07-03
Status: aprovado, aguardando plano de implementação

## Contexto

Conversa com o usuário sobre melhorias no `ntb-vendas-next` antes de iniciar a
integração com o Norte Estoque. O pedido original tinha três frentes: feature
concreta, repriorizar as 15 ideias standby de `docs/VARREDURA-2026-07-02.md`
e brainstormar ideias novas. Isso é grande demais pra um spec só, então foi
decomposto em sub-projetos. Este documento cobre só o primeiro sub-projeto:
a tela "Meu Link / QR Code". A repriorização do backlog e as ideias novas
seguem como roadmap conversacional, sem spec próprio por enquanto. Ver
"Fora de escopo" no fim deste documento.

Hoje cada loja tem um link funcional (`/c/[slug]`) mas ele só existe de
forma implícita: o Master Admin vê o slug como texto num campo de formulário
(`AdminModule.tsx`, linhas ~760-765, prefixo decorativo `site.com/c/`
hardcoded, nunca o domínio real) e um botão "Ver Cardápio" que abre o link
em nova aba. Não existe, em lugar nenhum do sistema, uma tela com o link
completo pronto pra copiar, nem qualquer geração de QR Code, confirmado por
busca no projeto inteiro (nenhuma lib de QR no `package.json`, nenhuma
ocorrência de geração de QR no código). O Lojista, dono do restaurante e
quem efetivamente vai imprimir e colar o QR Code na mesa, não tem acesso a
essa informação hoje.

## O que muda

**Local:** nova sub-aba "Meu Link / QR Code" dentro de "Administração" no
painel do Lojista (`StoreAdminView` em `components/modules/StoreModule.tsx`),
ao lado de "Dashboard", "Histórico de Vendas" e "Gestão de Usuários", mesmo
padrão de abas já existente, mesmo gate de permissão (`canAccess('admin')`).
Não aparece no Master Admin: é uma tela exclusiva do painel do Lojista,
decisão explícita do usuário nesta conversa.

**Conteúdo da tela:**
- Nome da loja (já disponível via `store.name`, mesma prop que as outras
  sub-abas de `StoreAdminView` recebem).
- O link completo e real: `${window.location.origin}/c/${store.slug}`,
  calculado no client a partir da URL que o navegador está usando de fato.
  Funciona certo em produção, preview da Vercel ou localhost sem precisar de
  nenhuma variável de ambiente nova (resolve a lacuna documentada na
  pesquisa: hoje nenhum domínio real está codificado em lugar nenhum do
  projeto).
- Botão "Copiar Link", usando `navigator.clipboard.writeText`, com
  `toast.success` de confirmação (mesmo padrão de feedback já usado no
  resto do sistema, ex. `ClientModule.tsx:1560`).
- QR Code gerado na hora, apontando pro link acima.
- Botão "Baixar QR Code (PNG)".

## Abordagem técnica

**Geração do QR Code: client-side, sem rota de API nova.** Usar a lib
`qrcode` (mesma que o projeto irmão `ntb-estoque-next` já usa em produção
pra etiquetas, escolha validada, não é a primeira vez que essa lib roda
nesse contexto de negócio). Gera o QR direto num `<canvas>` via
`QRCode.toCanvas(canvasRef.current, url, opts)` dentro de um `useEffect` que
reroda quando `url` muda.

Alternativa descartada: chamar um serviço de terceiro tipo
`api.qrserver.com` via `<img src="...">`. Mais simples de montar, mas manda
o link da loja pra um serviço externo e o QR para de funcionar se esse
serviço cair. Sem necessidade, já que gerar client-side é igualmente
simples e não tem essas duas desvantagens.

**Download do PNG:** o mesmo `<canvas>` usado pra exibir o QR na tela vira o
PNG baixado, via `canvas.toDataURL('image/png')` mais um `<a download>`
temporário disparado por clique programático. Não precisa de nenhuma lib
adicional além da `qrcode` (que já resolve o desenho no canvas).

**Nova dependência:** `qrcode` (e `@types/qrcode` como dev dependency, já
que o projeto é TypeScript). Nenhuma outra mudança de dependência.

## Tratamento de erros e casos de borda

- `navigator.clipboard` indisponível (navegador antigo, contexto não-HTTPS):
  `try/catch` ao redor do `writeText`; no `catch`, `toast.error` com uma
  mensagem indicando pra selecionar o texto do link manualmente (o link
  continua visível e selecionável na tela, nunca escondido atrás só do
  botão de copiar).
- `store.slug` vazio ou ausente: não deveria acontecer (toda loja tem slug
  desde a criação), mas se ocorrer, a tela mostra um estado de aviso
  ("Link da loja não configurado corretamente. Contate o suporte.") em vez
  de gerar um QR Code apontando para uma URL quebrada.
- Geração do QR falha silenciosamente (raro, mas a lib pode rejeitar por
  string vazia): mesmo tratamento acima, não deixa um canvas em branco sem
  explicação.

## Testes

Projeto não tem suite automatizada (só `lint`/`build`). Validação via
`npx tsc --noEmit` e `npm run build` limpos (convenção já estabelecida
neste projeto), e teste manual: abrir a aba na loja de demonstração
("Bistrô Demo", nunca em loja real de cliente), conferir que o link
mostrado bate com o domínio real do ambiente, testar o botão copiar
(colar em outro lugar pra confirmar), baixar o PNG e escanear de fato com
a câmera de um celular pra confirmar que abre o cardápio correto daquela
loja.

## Fora de escopo (documentado, não deste sub-projeto)

- Repriorização das 15 ideias de produto em standby
  (`docs/VARREDURA-2026-07-02.md`) e quaisquer ideias novas brainstormadas
  na conversa que originou este documento. Tratadas como roadmap
  conversacional, sem spec/plano formal ainda. Retomar depois que este
  sub-projeto estiver implementado.
- Integração com o Norte Estoque (baixa de estoque via ordem de produção
  automática ao vender um prato). Depende de decisões de arquitetura
  maiores (autenticação entre os dois sistemas, mapeamento de produto do
  cardápio para código de produto na Omie) fora do escopo desta spec; o
  próprio usuário pediu explicitamente pra deixar por último.
- Emissão de NFC-e/SEFAZ usando o certificado digital já armazenado. Já
  documentado como trabalho futuro separado em `AGENTS.md` e no design de
  01/07/2026, não reaberto aqui.
