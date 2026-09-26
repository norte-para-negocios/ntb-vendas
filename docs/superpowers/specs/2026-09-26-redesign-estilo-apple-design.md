# Redesign visual "estilo Apple" do NTB Vendas — design

## Objetivo
Pedido do dono (2026-09-26): o sistema inteiro com cara de app da Apple
(Ajustes do Mac, iPad, app Loja) — não "painel web". Aplicar em tudo:
painel do lojista (todas as abas), telas de entrada, cardápio do cliente,
Master Admin. Sem mudar funcionalidade.

## Evidência (prints "antes")
`~/ClaudeGerado/ntb-redesign-antes/desktop/` (40 telas) e `mobile/`.
Achados concretos:
1. Fonte Atkinson + JetBrains Mono: zeros cortados ("600ml", "R$ 0,00"),
   números em fonte de máquina de escrever (dashboard, totais, "2626min").
2. Rótulos em CAIXA ALTA espalhados (MESAS OCUPADAS, ÚLTIMOS PEDIDOS, HOJE,
   TOTAL A RECEBER, BANDEIRA, badges OCUPADA/LIVRE/MESA, "RECEBER &
   FINALIZAR").
3. Menu lateral azul-escuro pesado; rodapé com "Trocar de Loja" quebrando em
   2 linhas; faixa roxa de 4px no topo de toda página; subtítulo genérico
   "Gerencie seu estabelecimento" em toda aba; canto superior com pílula
   "Impressão" + quadrado "O" + data = ruído.
4. Muitas cores ao mesmo tempo: cartões de mesa rosa/verde no Caixa; modal
   da mesa com botões azul, roxo e verde; botão vermelho "Bloqueio PIN
   Ativo"; faixas coloridas à esquerda dos cartões do dashboard; avisos em
   caixas bege repetidas.
5. Caixas tracejadas nos estados vazios (Caixa, KDS).
6. Mesas livres ocupam o mesmo espaço grande das ocupadas, com ícone e
   "Disponível" — grade infinita; chip "•••• 👁" de PIN em todo cartão.
7. Tempo em minutos crus ("2626min").
8. Histórico de Vendas: barra de ferramentas espremida ("Por Opera",
   botões quebrando texto em 2 linhas).
9. Cardápio do lojista: ações "Editar Pausar Excluir" em 3 cores de texto.

## Linguagem visual (decisões)
- **Fonte:** do sistema — `-apple-system, BlinkMacSystemFont, "SF Pro Text",
  "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif` (SF no Mac,
  Segoe no Windows das lojas). Números: mesma fonte com `tabular-nums`.
  Monoespaçada só pra código (chave NFC-e, PIN, JSON).
- **Cores (claro):** fundo `#f5f5f7`; superfície `#ffffff`; superfície 2
  `#f2f2f7`; texto `#1d1d1f`; texto secundário `#6e6e73`; separador
  `rgba(60,60,67,0.14)`; marca `#484DB5` (só ação/seleção); ok `#248a3d`,
  aviso `#b25000`, erro `#d70015`, info `#0066cc` (tons Apple, AA).
- **Cores (escuro):** fundo `#000000`; superfície `#1c1c1e`; superfície 2
  `#2c2c2e`; texto `#f5f5f7`; secundário `#98989d`; separador
  `rgba(84,84,88,0.45)`; marca `#8b90ea`.
- **Raios:** 8 / 12 / 18px (sm/md/lg); modal/folha 22px; botões e chips em
  pílula.
- **Sombras:** quase nenhuma; cartões sem borda com sombra
  `0 1px 2px rgba(0,0,0,.04), 0 2px 12px rgba(0,0,0,.04)`.
- **Rótulos de seção:** frase normal, 13px, cinza secundário, peso 600 —
  nunca CAIXA ALTA. Títulos de página grandes (28–30px, -0.02em).
- **Status:** ponto colorido 8px + texto (ex.: ● Ocupada), sem blocos
  coloridos.
- **Menu lateral:** claro/translúcido (`bg-white/70` + blur), item ativo em
  pílula `brand-soft` com texto da marca; mesma coisa no tema escuro com
  `#1c1c1e/80`. Barra inferior do celular idem (tab bar iOS).
- **Controles:** SegmentedControl único pra grupos de visões; botões pílula
  (32/38/44px); inputs preenchidos (`surface-2`, sem borda, anel de foco da
  marca).
- **Movimento:** curto, sem "pulo" em hover de botão; mola só em folhas.

## Escopo por fase (cada fase publicada e fotografada antes da próxima)
1. Fundação: tokens, fonte, `.num`/`.eyebrow`, componentes de `ui.tsx`,
   casca do painel (menu, cabeçalho, barra do celular), SegmentedControl.
2. Telas do painel: Caixa, Mesas (+ modal da mesa, comanda, pagamento),
   Balcão, KDS, Cardápio do lojista, Administração (todas as abas).
3. Cardápio do cliente, telas de entrada/landing, Master Admin, tema escuro,
   prints "depois", versão do app desktop.

## Fora de escopo
Mudar fluxo/funcionalidade; mudar a cor da marca; trocar ícones (lucide
continua, traço 1.75).
