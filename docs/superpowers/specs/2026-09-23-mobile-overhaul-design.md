# Mobile overhaul do NTB Vendas — design

## 1. Objetivo

Deixar todas as telas do NTB Vendas boas de usar no celular (360–430px):
cardápio do cliente (QR na mesa), painel do lojista/garçom (Caixa, Mesas,
Balcão, KDS, Cardápio, Administração, Meu Perfil) e Master Admin. Depois
disso — e só depois — montar um Figma de todo o produto pra enviar a um
designer. Ordem definida pelo dono em 2026-09-23: análise → correções →
Figma por último (o designer não deve desenhar em cima de problemas).

## 2. Evidência

Auditoria de 2026-09-23 (não versionada, guardada em
`~/ClaudeGerado/ntb-vendas-mobile-audit-2026-09-23/`): 154 capturas em
390x844 e 360x740 (`shots/`, `shots2/` = fluxo operacional real no Sertão),
`index.md`/`index2.md` (nota por tela) e `code-audit.md` (arquivo:linha).
Achados com severidade Alta usados como base deste plano:
Master Admin sem navegação no celular; `viewport-fit=cover` ausente
(safe-area = 0); toast/banner cobrindo a barra inferior; `Modal` padrão é
cartão centralizado com `vh` (não `dvh`), sem trava de scroll e sem botão
fixo; pagamento com rolagem dentro de rolagem; alvos de toque de 11–34px nas
telas de mais uso; inputs < 16px (zoom do iOS) e sem `inputMode`.

## 3. Abordagem: fases, cada uma entregável sozinha

Cada fase é deployada e verificada ao vivo antes da próxima, e tem o próprio
plano (`docs/superpowers/plans/`), escrito quando a fase anterior fechar —
assim os passos de código são escritos lendo o código como ele estará então,
e não adivinhados agora.

1. **Base (plano já escrito)** — correções transversais de baixo risco que
   melhoram todas as telas de uma vez: viewport/safe-area/`dvh`, toast e
   barra inferior, `Modal` como folha no celular, inputs, alvos de 44px,
   legibilidade da barra inferior.
2. **Fluxo do garçom e pagamento** — botão "Lançar" e "Finalizar" fixos,
   observação do item visível (comanda, Pedidos do Dia, Balcão, KDS),
   opções obrigatórias sem pré-seleção no garçom, borda por tamanho de
   pizza, aviso claro no "Finalizar" desabilitado, feedback do resultado da
   nota fiscal, nome ao abrir mesa, confirmação de excluir nomeando o item,
   "Zerar Vendas" afastado das exportações.
3. **Master Admin e Administração** — navegação do Master no celular,
   sub-abas da Administração compactas, tabelas viram cartões no celular,
   formulários em 1 coluna no celular, ações do Cardápio com toque de 44px.
4. **Cliente** — cabeçalho compacto (produto visível mais cedo), folha do
   produto sem faixa vazia e sem "quadradinhos de letra" quando não há foto,
   tela de acompanhamento com itens/total/voltar; investigar o bug "aba
   Pizzas não rola até a seção" e o ícone vermelho de tempo real.
5. **Mesas e KDS** — cartões de mesa mais compactos, barra de botões sem
   quebra; decidir o KDS do Sertão (módulo desligado).
6. **Figma** — depois da fase 5, com as telas já corrigidas.

## 4. Decisões já tomadas
- Cor de ação = azul-violeta da Norte (feito em 2026-09-22).
- Testes de fluxo podem criar dados no Sertão (homologação) e são limpos
  por SQL depois; nunca tocar nos pedidos de outros testes do dia nem no
  caixa antigo aberto.
- Sem framework de teste no projeto: verificação = `npx tsc --noEmit` +
  medições/capturas com Playwright em viewport de celular contra o deploy.

## 5. Decisões pendentes do dono (não bloqueiam a fase 1)
- **KDS do Sertão** (fase 5): ligar Cozinha/Bar ou manter desligado e
  ajustar o aviso "pedido foi pra cozinha" mostrado ao cliente.
- **Figma** (fase 6): montar direto no Figma do dono pelo conector, ou
  entregar capturas + guia de componentes pro designer refazer.
- **Pré-seleção de opção obrigatória** (fase 2): no garçom passa a exigir
  escolha explícita; no cliente a pré-seleção atual (decisão de 2026-07-05
  para reduzir atrito) fica — confirmar.
- **Borda de pizza por tamanho** (fase 2): definir com o Ramon quais bordas
  valem pra cada tamanho.

## 6. Fora de escopo
Redesenho visual da marca, novas funcionalidades, app nativo, reforma de
`StoreModule.tsx` (arquivo enorme) — só o necessário em cada tarefa.
