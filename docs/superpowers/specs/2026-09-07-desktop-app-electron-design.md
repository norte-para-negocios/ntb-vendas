# App de Windows (Electron) — casca desktop pro painel do lojista + Master Admin

## Contexto e objetivo

Sub-projeto 1 de 3 do pedido "transformar o NTB Vendas num app funcional de
Windows" (2026-09-07). Os outros dois — integração de hardware local
(impressora/gaveta/leitor) e modo offline — ficam como projetos futuros
separados, cada um com seu próprio brainstorm; este spec cobre só a casca
desktop.

**Objetivo**: dar ao painel do lojista e ao Master Admin uma "cara de PDV
de verdade" — ícone na área de trabalho, abre sem navegador, tela cheia —
sem reescrever nenhuma lógica de negócio existente.

## Escopo

**Dentro:**
- App Electron novo, Windows, instalável (`.exe`), com atualização
  automática.
- Cobre as rotas `/acesso` (landing com os dois botões), `/painel`
  (Master Admin) e `/loja` (painel do lojista completo — Caixa, Mesas,
  Balcão, KDS, Cardápio, Administração).
- Nenhuma mudança de lógica de negócio, UI ou fluxo dentro dessas
  páginas — é reempacotamento, não reescrita.

**Fora (explicitamente, por decisão do usuário):**
- `/c/[slug]` (cardápio do cliente) — continua só web, acessado via QR
  code no celular do próprio cliente. Nunca vira app.
- Modo offline — projeto futuro à parte. Este app ainda exige conexão
  com a internet pra funcionar, exatamente como o site hoje.
- Integração com hardware (impressora além do que o `print-agent/` já
  cobre, gaveta de dinheiro, leitor) — projeto futuro à parte.
- macOS/Linux — só Windows por enquanto (é o SO usado nos PCs de caixa
  das lojas).

## Arquitetura

```
┌─────────────────────────────────────────────┐
│  App Electron (instalado no PC da loja)      │
│                                               │
│  ┌─────────────────────────────────────────┐ │
│  │ BrowserWindow (Chromium embutido)        │ │
│  │                                           │ │
│  │  Carrega LOCALMENTE (bundle no instalador)│ │
│  │  as páginas: /acesso, /painel, /loja      │ │
│  │  (build estático, mesmo HTML/JS/CSS que   │ │
│  │  o site em produção gera pra essas rotas) │ │
│  └─────────────────────────────────────────┘ │
│                    │                          │
│                    │ toda chamada de dado      │
│                    ▼ (Supabase + as poucas     │
│         ┌──────────────────────┐  rotas /api/*)│
│         │  Internet             │              │
└─────────┼──────────────────────┼──────────────┘
          │                      │
          ▼                      ▼
  ┌───────────────┐    ┌──────────────────────────┐
  │ Supabase       │    │ Servidor de produção      │
  │ self-hosted    │    │ (Contabo, o mesmo de      │
  │ (dado, realtime)│   │  sempre) — SÓ as rotas    │
  └───────────────┘    │  /api/certificado,        │
                        │  /api/fiscal/*,           │
                        │  /api/integracao/*        │
                        │  (têm a service role key, │
                        │  NUNCA podem ir pro       │
                        │  instalador)              │
                        └──────────────────────────┘
```

**Por que essa divisão** (achado de segurança da fase de brainstorm,
confirmado com o usuário): `/api/*` usa a service role key do Supabase,
que ignora RLS por completo. Embutir essas rotas dentro do instalador
levaria essa chave pro PC de cada loja — extraível trivialmente de um
app Electron (é só descompactar o `.asar`). Isso daria a qualquer loja
física acesso de leitura/escrita a **qualquer outra loja da plataforma**,
incluindo senha em texto puro (dívida técnica já documentada no
AGENTS.md). Mantendo essas rotas só no servidor remoto, o app desktop
tem exatamente o mesmo modelo de segurança que o navegador já tem hoje —
nada novo exposto.

## Componentes

### `desktop/` (novo, dentro do repo `ntb-vendas` — mesmo padrão de
`print-agent/`, um programa satélite que roda no PC da loja, versionado
junto do site principal)

- **`desktop/electron/main.ts`** — processo principal do Electron: cria
  a `BrowserWindow`, carrega a página inicial local (`/acesso`), define
  o comportamento de janela (tela cheia opcional, ícone, menu removido —
  "cara de PDV", não de navegador).
- **`desktop/electron/preload.ts`** — script de preload, exposto ao
  `window` das páginas carregadas. Único papel: expor uma flag
  `window.electronApp = true` e a URL base de produção
  (`NEXT_PUBLIC_APP_URL` já existe no projeto, ver `AGENTS.md`) pro
  código React saber que está rodando dentro do app e resolver as
  chamadas de `/api/*` pra URL absoluta.
- **`desktop/build/`** — pipeline de build que gera o HTML/JS/CSS
  estático de `/acesso`, `/painel`, `/loja` a partir do MESMO código-
  fonte do site principal (não é um fork nem uma cópia — usa
  `next build` com `output: 'export'` restrito a essas 3 rotas, ou uma
  config de build dedicada; a mecânica exata de como excluir `/c/[slug]`
  e as rotas `/api/*` do export fica pro plano de implementação, não
  pro spec).
- **`desktop/package.json`** — dependências do Electron
  (`electron`, `electron-builder`, `electron-updater`), separado do
  `package.json` do site principal (evita inflar o bundle do site com
  dependências de desktop).

### Mudança mínima no código do site principal

- **`lib/api.ts`** (e qualquer outro lugar que hoje chama
  `fetch('/api/certificado', ...)`, `fetch('/api/fiscal/...')` etc. com
  caminho relativo): um helper novo, `resolverUrlApi(caminho: string)`,
  que devolve o caminho relativo de sempre no navegador normal, mas a
  URL absoluta de produção quando `window.electronApp` está presente.
  Domínio a usar: `https://testvendase.norteparanegocios.com.br` — é
  onde o projeto trabalha hoje (`vendas.*` é o definitivo, ainda não
  mexer). Trocar pro domínio definitivo depois é só trocar uma
  constante, não uma decisão de arquitetura. Único lugar novo de lógica
  condicional no código do site.

## Atualização automática

`electron-updater`, provider `generic` (HTTP simples, sem GitHub
Releases) — aponta pra uma pasta nova no Contabo (ex.:
`https://updates.norteparanegocios.com.br/ntb-vendas-desktop/`, servida
por nginx como arquivo estático, mesmo padrão de infra já usado no
projeto). Publicar uma versão nova = rodar `electron-builder` localmente
(ou via script), subir o `.exe` + o `latest.yml` gerado pra essa pasta
via `scp` — mesmo fluxo manual (`git push` + rodar um script) já usado
pro resto do projeto, sem introduzir CI/CD novo.

O app confere atualização automaticamente ao abrir; se houver uma nova,
baixa em background e aplica no próximo reinício (comportamento padrão
do `electron-updater`, sem interromper quem está no meio de uma venda).

## Testes

Sem suíte de testes automatizada neste projeto (confirmado — todo o
resto do NTB Vendas também não tem). Verificação planejada:
1. `npm run build` do bundle desktop gera as 3 páginas sem erro.
2. Rodar o app localmente (`electron .` em modo dev), confirmar que
   `/acesso` → `/loja`/`/painel` navegam e logam normalmente contra o
   Supabase de produção, usando a loja de teste (ZZ Laboratorio).
3. Confirmar que uma chamada real a uma rota `/api/*` (ex.: salvar
   certificado) funciona rodando DENTRO do app Electron — é o único
   comportamento genuinamente novo desta feature (resolução de URL
   absoluta), tudo o resto é o app de sempre numa janela diferente.
4. Testar o instalador `.exe` gerado numa VM ou máquina Windows real
   (ícone, atalho, abre em tela cheia).
5. Testar auto-update: publicar uma v2 de teste, confirmar que uma
   instalação da v1 detecta, baixa e aplica.

## Fora de escopo (registrado, não esquecido)

- Login automático/"lembrar loja" — o app abre no login normal de
  sempre, sem atalho de sessão persistida além do que o `localStorage`
  já faz hoje.
- Branding por loja (logo custom no instalador, etc.) — um instalador
  único pra todas as lojas, igual o site é um site só pra todas.
- Qualquer coisa de hardware ou modo offline — próximos sub-projetos.
