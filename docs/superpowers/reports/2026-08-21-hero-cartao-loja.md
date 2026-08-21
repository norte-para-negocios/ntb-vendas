# Hero do cardápio: cartão da loja no formato iFood

Continuação do redesign do hero (`components/modules/ClientModule.tsx`, `/c/[slug]`), fechando os 5 gaps estruturais apontados pelo usuário em relação ao app do iFood. Escopo estritamente do hero (capa + logo + cartão de identificação) — nada abaixo dele (busca sticky/tabs/scroll-spy, seções, linhas de produto, Destaques, modal de produto) foi tocado.

**Nota importante: esta mudança não foi vista renderizada.** Não há navegador disponível nesta sessão. `npm run build` passa limpo (typecheck + build de produção), mas a validação visual (geometria do logo, contraste dos botões sobre a capa, comportamento do acordeão de endereço) fica pendente do usuário dirigindo ao vivo, como o próprio pedido já previa.

## 1. Logo centralizada

`components/modules/ClientModule.tsx:~3060` — o wrapper absolutamente posicionado do logo (que existe justamente por causa do conflito de `relative` interno do `ProductThumb`, documentado no comentário já existente no arquivo) trocou `left-4` por `left-1/2 -translate-x-1/2`. Mantido tudo o resto: `-bottom-8`, `w-16 h-16`, `ring-4 ring-[var(--surface)]`, `z-10`.

**Geometria esperada:** o container da capa é `relative w-full h-[200px]`. Com `-bottom-8` (-32px) e altura do logo 64px, o topo do círculo fica 32px **acima** da borda inferior da capa, e o fundo do círculo fica 32px **abaixo** dela (já dentro do cartão branco) — ou seja, o logo cruza a borda cobrindo exatamente metade da própria altura (32px) de cada lado, igual ao pedido ("bottom ~32px below the cover's bottom edge... overlaps by about half its height"). Só a coordenada horizontal mudou.

## 2. Linha do nome: ícone + chevron, expansível

A linha do nome virou um `<button>` de verdade (focável, `aria-label="Informações da loja"`, `aria-expanded`), com `MapPin` (lucide-react, cor `IFOOD_RED`, já definida no arquivo) antes do nome e `ChevronRight` no fim, que rotaciona 90° (`transition-transform`, CSS puro, não um spring novo) quando expandido.

**Decisão sobre o destino (pedida explicitamente no brief):** este app não tem nenhuma tela/rota de "informações da loja". Em vez de linkar pra um destino fictício, **a própria linha expande/recolhe em lugar** (`storeInfoExpanded`, `useState` local) revelando o endereço completo logo abaixo (ver item 3). É a opção B do brief ("do not create a fake destination — instead make the row expand/collapse in place").

## 3. Linha de metadados com endereço real

Duas linhas novas, ambas alimentadas por `fiscalConfig` (`useState<StoreFiscalConfig | null>`, carregado via `fetchStoreFiscalConfig(currentStore.id)` — a função já existente em `lib/api.ts`, nenhuma query nova):

- **Linha curta, sempre visível** quando há dado: `composeStoreAddressLine()` compõe `bairro, cidade/UF` (ex.: "Praia do Forte, Mata de São João/BA" na forma pretendida — ver ressalva de acentuação abaixo).
- **Linha completa, só quando expandida** (item 2): `composeFullStoreAddress()` acrescenta logradouro+número antes da linha curta.

Ambas retornam `null` quando `fiscalConfig` é `null` ou os campos usados estão vazios — nesse caso **nenhuma linha renderiza**, nunca um placeholder.

**Ressalva real sobre acentuação:** o helper `titleCaseAddress()` só normaliza capitalização (Title Case, preposições curtas em minúsculo, `S/N` preservado em maiúsculo) — ele **não** restaura acentos perdidos. O valor cru no banco é `MATA DE SAO JOAO` (sem cedilha/acento nenhum); sem um dicionário, isso vira `Mata De Sao Joao`, não `Mata de São João` como o exemplo do brief mostrava. Registrado no comentário do helper no código. Se o usuário quiser o acento de volta, a opção honesta é corrigir o dado na origem (`store_fiscal_config`), não inventar uma normalização de acentos no client.

## 4. Divisor + segunda linha

O iFood usa esse espaço pra nota (estrelas). **Este app não tem avaliação agregada de loja** (`order_ratings` é por pedido, não dá pra virar "nota da loja" sem uma feature nova) — não inventei uma.

**Decisão tomada (uma das 3 variantes previstas no brief, mas nenhuma delas isolada — misturei conforme o estado real):**
- **Com sessão de mesa aberta** (`hasAccess && currentTable`): linha tappable, reaproveita a MESMA derivação mesa/balcão já usada no chip de sessão logo acima (`currentTable ? 'Mesa N' : 'Balcão'`, nunca recalculada) — mostra "Mesa N • ver conta" e abre a Conta (`setShowBill(true)`, o mesmo destino do botão "Conta" do cabeçalho, reaproveitado).
- **Com sessão de balcão** (`hasAccess && !currentTable`): linha só informativa ("Pedido no balcão"), **sem** `<button>` nem chevron — não existe nenhuma tela pra abrir nesse estado, e um chevron ali prometeria uma ação inexistente.
- **Sem sessão** (`!hasAccess`): linha tappable convidando a abrir mesa/comanda, que abre o MESMO modal de login já existente (`setIsLoginModalOpen(true)`) — ação real, não uma tela nova.

Único caso que se aproxima do fallback "omit entirely without session" pedido no brief é a variante de balcão, que fica sem afordância de toque (mas continua visível, porque há informação real — "pedido no balcão" — pra mostrar).

## 5. Coração + busca sobre a capa

Dois botões circulares translúcidos (`bg-black/35 backdrop-blur-sm rounded-full w-9 h-9`, mesmo tratamento do `ThemeToggle` já existente ali) adicionados ao grupo de controles no topo-direito da capa, ao lado do toggle de tema (mantido) e do botão de sair (mantido, condicional a `hasAccess`).

- **Coração**: `onClick={() => setFavoritesOnly(v => !v)}` — o MESMO estado usado pelo botão de favoritos da barra sticky (`favoritesOnly`), nunca um segundo mecanismo. `aria-pressed` + `aria-label` dinâmico.
- **Lupa**: `onClick` rola até `stickyBarRef` (`scrollIntoView`) e foca `searchInputRef` (ref novo, atribuído ao `<input>` de busca já existente na barra sticky) — não abre uma segunda busca, só direciona pra ela.

## Verificação

`npm run build` — compilou limpo (Turbopack, TypeScript, geração estática das 16 rotas), sem erros nem warnings novos.

## Arquivos tocados

- `components/modules/ClientModule.tsx` — único arquivo alterado: imports (`MapPin`, `fetchStoreFiscalConfig`, `StoreFiscalConfig`), 2 novos `useState` (`fiscalConfig`, `storeInfoExpanded`) + 1 `useRef` (`searchInputRef`), 1 `useEffect` novo (carrega `fiscalConfig`), 3 helpers de módulo novos (`titleCaseAddress`, `composeStoreAddressLine`, `composeFullStoreAddress`), e o JSX do hero (capa, logo, cartão) editado conforme os 5 itens acima.
