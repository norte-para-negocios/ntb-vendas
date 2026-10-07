# Redesign do cadastro de loja (Norte Vendas + Norte Estoque) — Vendas IMPLEMENTADO em 06/10/2026 (branch redesign-loja); Estoque e itens 3–5 seguem como plano

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development ou superpowers:executing-plans. Este documento é só o PLANO pedido pelo dono em 06/10/2026 (parte do spec `ntb estoque/docs/superpowers/specs/2026-10-06-modos-de-loja-estoque-proprio-design.md`, seção 4b). Nada daqui foi implementado além do seletor de modo de estoque já existente no modal atual (commit `feat(estoque): seletor do modo de estoque…`).

**Goal:** o Master Admin do Vendas e a tela de Lojas do Estoque passam a cadastrar e editar a loja inteira (tipo, operação, estoque, fiscal, integrações) num modal largo e organizado, e uma loja criada de um lado aparece no outro quando o operador marca "criar lá também".

**Pedido do dono (palavras dele):** o modal de "Nova Loja"/"Editar Loja" "fica 70% da tela. Tá ridículo ele só aqui no meio"; "coloca muita opção, escolher qual vai ser o tipo, se vai ser com esse, com o NTB Estoque… se vai criar lá também, se é balcão mais mesa, apenas balcão… dê muito mais configuração, igual o Norte Estoque"; "o Norte Estoque também tem um local para criar lojas… se for para ativar… editar loja se eu quiser trocar os tipos de loja".

## Estado atual (06/10/2026)

- `components/modules/AdminModule.tsx`: um único `<Modal>` de tamanho padrão `sm` (`max-w-md`, 448 px) com uma coluna longa: status do contrato, logo, capa, nome, CNPJ, meses de contrato, taxa de serviço, link, contrato (balcão / balcão+mesas), nº de mesas, perfil de módulos, fluxo de pedido, caixa, cardápio vitrine, seletor de modo de estoque (novo), "criar no Norte Estoque também", e, só em edição, blocos Collapsible de certificado e fiscal, integração com o Estoque.
- `components/ui.tsx` já tem `Modal size="lg"` (`sm:max-w-[85vw] xl:max-w-[1100px]`), usado por outras telas; o modal da loja nunca foi migrado.
- Norte Estoque: `components/loja/LojaForm.tsx` + `LojaCard` (criar/editar loja, chaves Omie, certificado, mapeamento de locais, integração com Vendas). A Frente C do Estoque adiciona o seletor de modo e "criar também no Vendas".

## Alvo

### 1. Layout do modal (Vendas)
- `Modal size="xl"` novo: `w-[min(70vw,1200px)]` em ≥1024 px, `w-[calc(100vw-2rem)]` abaixo; altura máxima `90dvh`, cabeçalho e rodapé fixos, corpo com rolagem própria.
- Dentro: navegação lateral de seções (em celular vira abas horizontais roláveis) + painel da seção ativa; botão **Salvar** sempre visível no rodapé, com indicador de "alterações não salvas"; seções com erro de validação ganham marca vermelha na navegação.
- Mesmo padrão visual do Vendas (azul-violeta Norte `#484DB5`, tokens atuais). **Sem redesenhar** o resto do app; protótipo em tela (3 variações de navegação) antes de codar, como o dono pede para qualquer redesign.

### 2. Seções e campos
| Seção | Campos |
|---|---|
| Identidade | status (ativa/inativa), logo, capa, nome do estabelecimento, nome fantasia, CNPJ (com máscara e validação), link (slug) com checagem de disponibilidade, cor da marca |
| Contrato | plano, meses (ou sem prazo), data de ativação, observações internas |
| Operação | **tipo da loja**: Balcão + Mesas / Só balcão; nº de mesas (só com mesas); módulos (Mesas, Balcão, KDS, Cardápio, Administração); fluxo de pedido; "balcão paga primeiro"; cardápio vitrine; taxa de serviço (%) |
| Estoque | **modo**: Com Omie / Estoque próprio / Sem estoque (cartões como no seletor atual); "criar também no Norte Estoque" (obrigatório em Estoque próprio, escondido em Sem estoque); local padrão de baixa; mostra o estado da integração (chave, conexão testada, modo teste); troca de modo só antes da primeira baixa (regra do servidor já existe) |
| Fiscal | ambiente (homologação/produção, com aviso forte de produção), certificado, CSC/CSCID, séries, CST/CSOSN padrão; emite nota automática sim/não |
| Integrações | Norte Estoque (URL/chave/ativo, testar conexão), Omie direto (só loja Omie) |
| Acessos | usuários da loja, conta universal |

### 3. Criar/editar nos dois sistemas
- **Vendas → Estoque (já existe):** `POST /api/integracao/criar-loja-estoque` → Estoque `/api/integracao/lojas` (body já leva `modo`). Passa a ser um passo visível no fim do "Salvar", com resultado por sistema ("Vendas: ok · Estoque: ok / falhou: motivo [Tentar de novo]") em vez de um toast.
- **Estoque → Vendas (já existe):** `criarLojaNoNtbVendas` com `stockMode`. Mesmo resultado por sistema.
- **Vínculo de loja existente:** em "Editar", seção Integrações oferece "Escolher a loja do outro sistema" (lista por CNPJ/nome) em vez de colar chave à mão; gera a chave e preenche os dois lados.
- **Editar tipo depois:** trocar Balcão+Mesas ↔ Só balcão com as travas já implementadas (mesas ocupadas bloqueiam); trocar o modo de estoque com a trava das baixas; ativar/desativar loja nos dois lados.

### 4. Norte Estoque (tela de Lojas)
- Mesmo critério de largura/organização no `LojaForm`; seções: Identidade, Estoque (modo), Fiscal, Integração com o Vendas, Locais iniciais (semeados: Estoque Geral, Bar, Cozinha), Famílias iniciais.
- Lista de lojas com selo do modo (Omie / Próprio / Sem estoque), estado (ativa/inativa), última sincronização e atalho "Abrir no Vendas".

## Tarefas (cada uma termina com tsc, testes e captura de tela)
1. Componente `Modal size="xl"` + `FormularioEmSecoes` (navegação lateral/abas, rodapé fixo, "não salvo") em `components/ui` — teste de acessibilidade (foco preso, Esc, rótulos).
2. Quebrar `AdminModule.tsx` (hoje ~1900 linhas só de formulário) em `components/modules/admin/loja/{Identidade,Contrato,Operacao,Estoque,Fiscal,Integracoes}.tsx`, mantendo `createStore/updateStore` e o estado atual; regressão: salvar com os mesmos campos produz o mesmo `config`.
3. Protótipo de 3 navegações → escolha do dono → implementar a escolhida.
4. Resultado por sistema no "Salvar" (hook `useCriarNosDoisSistemas`).
5. "Escolher a loja do outro sistema" (rota nova de listagem nos dois lados, autenticada pelo segredo cross-sistema; sem expor chaves).
6. Espelhar o formulário no Estoque (`LojaForm`).
7. QA: criar loja de teste em cada modo nos dois sistemas, editar tipo e modo, desativar, apagar loja de teste; celular 390 px; tema escuro; portão do Vendas passa antes do deploy (nunca com o Sertão operando).

## Fora de escopo
Cobrança/planos (só campo informativo), importação de lojas em lote, permissões finas do Master Admin.

## Review Focus
1. Salvar sem tocar nas seções novas mantém exatamente o `config` e as colunas de hoje (loja Omie existente não muda).
2. Falha de um sistema não desfaz o outro e é recuperável sem recriar a loja.
3. Modo de estoque com baixas existentes nunca troca (servidor recusa, tela explica).
4. Loja de teste e loja real nunca se confundem (selo visível; produção fiscal exige confirmação).
5. Modal em 390 px: sem rolagem horizontal, botão Salvar sempre alcançável.


## Implementado em 06/10/2026 (Vendas)

- `Modal size="xl"` (70% x 90%, máx. 1180 px; celular = folha quase cheia) em `components/ui.tsx`; os demais tamanhos não mudaram.
- `components/modules/admin/LojaModalShell.tsx` (navegação por seções, painel com rolagem, rodapé fixo, seções sempre montadas) e `PreparoImpressaoSection.tsx`.
- Seções: Identidade, Contrato, Operação, **Preparo e impressão**, Estoque, Fiscal, Integrações; criar e editar usam o mesmo componente; estado e handlers continuam em `AdminModule.tsx`.
- **Preparo e impressão:** Cozinha e Bar + locais criados pelo admin (`print_sectors`); cada local é *Acompanhamento* (tela) ou *Impressão direta*, guardado em `stores.config.locais_preparo_modo` (chave do local → modo). Loja nova: locais pendentes são criados depois da loja. Sem mexer nos modos o `config` fica byte-idêntico (testado: salvar sem tocar mantém o config).
- Runtime: `modoDoLocal` (default derivado de `order_flow` + módulos KDS) e `listarLocaisComTela(…, modos)` escondem a tela de acompanhamento dos locais em *Impressão direta*. `order_flow` e `kitchen_kds/bar_kds` são derivados dos modos quando o admin os altera. **Limite conhecido:** o fluxo geral (`order_flow`) do `StoreModule` continua sendo da loja inteira; em loja *mista* o local em impressão direta só perde a tela, e o que imprime depende das impressoras cadastradas para o local (Configurações → Impressão).
- Testes: `scripts/testes/locaisPreparoModo.test.ts`.
