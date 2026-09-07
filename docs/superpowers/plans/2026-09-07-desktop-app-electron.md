# App Desktop Windows (Electron) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empacotar `/acesso`, `/loja` e `/painel` como um app Windows
instalável (Electron), com atualização automática, sem expor nenhuma
credencial de servidor no `.exe` distribuído.

**Architecture:** Um sub-projeto Next.js novo em `desktop/webapp/` (sem
`package.json`/`node_modules` próprios — reaproveita os do repo raiz via
`next build desktop/webapp`), configurado com `output: 'export'`, que
reexporta as MESMAS páginas/componentes do site principal (nenhum código
duplicado). O `desktop/` também tem o processo Electron
(`electron/main.js`/`preload.js`, JavaScript puro, sem build step —
simples demais pra justificar TypeScript aqui) que carrega o HTML
estático gerado. Chamadas a `/api/*` do site principal passam a resolver
pra URL absoluta de produção quando rodando dentro do Electron (única
mudança no código do site).

**Tech Stack:** Electron 33 + electron-builder (empacotamento NSIS) +
electron-updater (atualização automática, provider `generic`); Next.js
16 `output: 'export'` pro bundle da interface.

**Spec:** `docs/superpowers/specs/2026-09-07-desktop-app-electron-design.md`

## Global Constraints

- **Nenhuma rota `/api/*` (nem a service role key) pode ir pro
  instalador** — só HTML/JS/CSS estático de `/acesso`, `/loja`, `/painel`.
  Toda chamada a `/api/*` de dentro do app usa a URL absoluta de produção.
- **Domínio de produção a usar**: `https://testvendase.norteparanegocios.com.br`
  (é onde o projeto trabalha hoje — `vendas.*` é o definitivo, não mexer).
- **`/c/[slug]` nunca entra no bundle desktop** — continua só web/QR code.
- Sem suíte de testes automatizada neste projeto — verificação é sempre
  manual (`npm run build`, rodar o app, conferir na tela), mesmo padrão já
  usado no resto do repo.
- Windows é o único alvo de build (`nsis` target do electron-builder).

---

## Task 1: Helper de resolução de URL da API + aplicar nos 12 call sites (site principal)

**Files:**
- Modify: `lib/api.ts` (adiciona o helper perto do topo do arquivo, e
  troca os 12 call sites de `fetch('/api/...')` listados abaixo)

**Interfaces:**
- Consumes: nada novo.
- Produces: `resolverUrlApi(caminho: string): string`, e o tipo global
  `Window.electronApp` — consumidos pela Task 5 (preload.js escreve
  nesse objeto).

- [ ] **Step 1: Adicionar o helper e o tipo global no topo de `lib/api.ts`**

Logo depois dos imports, antes da primeira função exportada:

```ts
// App desktop (Electron, ver docs/superpowers/specs/2026-09-07-desktop-app-
// electron-design.md): a interface roda embutida no instalador, mas as
// rotas /api/* (têm a service role key) continuam só no servidor de
// produção — nunca podem ir pro .exe. `window.electronApp` só existe
// quando o código roda dentro do app desktop (setado pelo preload.js,
// ver desktop/electron/preload.js); no navegador normal, `resolverUrlApi`
// devolve o caminho relativo de sempre, sem nenhuma mudança de
// comportamento.
declare global {
  interface Window {
    electronApp?: { isElectron: boolean; apiBaseUrl: string };
  }
}

function resolverUrlApi(caminho: string): string {
  if (typeof window !== 'undefined' && window.electronApp?.isElectron) {
    return `${window.electronApp.apiBaseUrl}${caminho}`;
  }
  return caminho;
}
```

- [ ] **Step 2: Trocar os 12 call sites**

Rodar este grep pra confirmar a lista antes de editar (os números de
linha podem ter mudado desde que este plano foi escrito):

```bash
grep -n "fetch('/api" lib/api.ts
```

Em cada um dos 12 pontos abaixo, trocar `fetch('/api/XXX'` por
`fetch(resolverUrlApi('/api/XXX')`, sem mexer em mais nada da chamada
(headers, body, method continuam idênticos):

1. `'/api/integracao/criar-produto-estoque'`
2. `'/api/orders/pagamento-balcao'`
3. `'/api/integracao/ordem-producao'`
4. `'/api/fiscal/emitir'` (aparece 2 vezes no arquivo — trocar as duas)
5. `'/api/push/send'`
6. `'/api/certificado'` (aparece 2 vezes no arquivo — trocar as duas)
7. `'/api/integracao/configurar'`
8. `'/api/integracao/omie-direto'`
9. `'/api/integracao/criar-loja-estoque'`
10. `'/api/fiscal/pdf-url'`

Exemplo de como fica (era `fetch('/api/certificado', { method: 'POST', body: form })`):

```ts
const res = await fetch(resolverUrlApi('/api/certificado'), { method: 'POST', body: form });
```

- [ ] **Step 3: Confirmar que sobrou zero chamada não-tratada**

```bash
grep -n "fetch('/api" lib/api.ts
```

Esperado: **zero** resultados (todas agora começam com
`fetch(resolverUrlApi(`).

```bash
grep -c "resolverUrlApi('/api" lib/api.ts
```

Esperado: **12**.

- [ ] **Step 4: Verificar que compila**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add lib/api.ts
git commit -m "feat: resolverUrlApi — chamadas /api/* usam URL absoluta dentro do app desktop

Pré-requisito pro app desktop Electron (ver docs/superpowers/specs/
2026-09-07-desktop-app-electron-design.md): a interface vai rodar
embutida no instalador, mas as rotas /api/* continuam só no servidor
de produção (têm a service role key, nunca pode ir pro .exe). No
navegador normal o comportamento não muda em nada — resolverUrlApi só
troca o caminho quando window.electronApp existe."
```

---

## Task 2: Scaffold do sub-app `desktop/webapp/` (build estático das 3 páginas)

**Files:**
- Create: `desktop/webapp/next.config.ts`
- Create: `desktop/webapp/tsconfig.json`
- Create: `desktop/webapp/next-env.d.ts`
- Create: `desktop/webapp/app/layout.tsx`
- Create: `desktop/webapp/app/page.tsx`
- Create: `desktop/webapp/app/loja/page.tsx`
- Create: `desktop/webapp/app/painel/page.tsx`

**Interfaces:**
- Consumes: `AcessoPage` (default export de `app/acesso/page.tsx`),
  `LojaPage`/`metadata` (de `app/loja/page.tsx`), `PainelPage`/`metadata`
  (de `app/painel/page.tsx`), `RootLayout`/`metadata`/`viewport` (de
  `app/layout.tsx`) — todos já existem no site principal, nenhum
  modificado por esta task.
- Produces: `desktop/webapp/out/` (diretório de build estático, gerado
  por `next build desktop/webapp`, consumido pela Task 4).

- [ ] **Step 1: Criar `desktop/webapp/next.config.ts`**

```ts
import type { NextConfig } from 'next';

// Build estático (sem servidor) — só pra estas 3 rotas. next/image exige
// unoptimized:true em modo export (a otimização de imagem normal precisa
// de um servidor rodando, que este bundle não tem).
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
};

export default nextConfig;
```

- [ ] **Step 2: Criar `desktop/webapp/tsconfig.json`**

Mesma configuração do `tsconfig.json` da raiz, só com o path alias `@/*`
ajustado pra apontar 2 níveis acima (raiz do repo, de onde vêm
`components/`, `lib/`, `context/`, `app/`):

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["../../*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Criar `desktop/webapp/next-env.d.ts`**

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
```

- [ ] **Step 4: Criar `desktop/webapp/app/layout.tsx`**

Reexporta o layout do site principal — mesmo arquivo, nenhuma
duplicação de conteúdo (o `import './globals.css'` de dentro dele
resolve relativo ao arquivo ORIGINAL, não a este reexport, então
funciona sem ajuste):

```tsx
export { metadata, viewport, default } from '@/app/layout';
```

- [ ] **Step 5: Criar `desktop/webapp/app/page.tsx`** (raiz do bundle = `/acesso` de hoje)

```tsx
export { default } from '@/app/acesso/page';
```

- [ ] **Step 6: Criar `desktop/webapp/app/loja/page.tsx`**

```tsx
export { metadata, default } from '@/app/loja/page';
```

- [ ] **Step 7: Criar `desktop/webapp/app/painel/page.tsx`**

```tsx
export { metadata, default } from '@/app/painel/page';
```

- [ ] **Step 8: Rodar o build e resolver o que aparecer**

```bash
npx next build desktop/webapp
```

Isso reaproveita o `node_modules` da raiz do repo (não precisa de
`npm install` separado — `desktop/webapp` não tem `package.json`
próprio de propósito). **Se o build falhar** com um erro do tipo
`useSearchParams() should be wrapped in a suspense boundary` (comum em
export estático quando um componente client usa esse hook sem
`<Suspense>` em volta): localizar o componente indicado no erro dentro
de `StoreModule.tsx`/`AdminModule.tsx`/`app/acesso/page.tsx` e envolver
o uso com `<Suspense fallback={null}>...</Suspense>` no mesmo arquivo —
é uma mudança pequena e local, não mexe em lógica de negócio. Se
aparecer, documentar exatamente o que foi envolvido no relatório desta
task (é o único tipo de ajuste esperado no site principal por causa do
export estático).

Esperado ao final: `desktop/webapp/out/index.html`,
`desktop/webapp/out/loja/index.html`, `desktop/webapp/out/painel/index.html`
existem.

```bash
ls desktop/webapp/out/index.html desktop/webapp/out/loja/index.html desktop/webapp/out/painel/index.html
```

- [ ] **Step 9: Commit**

```bash
git add desktop/webapp
git commit -m "feat: desktop/webapp — build estático de /acesso, /loja, /painel pro app Electron

Reaproveita os componentes/páginas do site principal via reexport (sem
duplicar código) e o node_modules da raiz do repo (sem package.json
próprio). output:'export' gera desktop/webapp/out/ com só as 3 páginas
que o app desktop precisa — /c/[slug] e as rotas /api/* nunca entram
aqui."
```

---

## Task 3: Processo Electron (`main.js` + `preload.js`)

**Files:**
- Create: `desktop/package.json`
- Create: `desktop/electron/main.js`
- Create: `desktop/electron/preload.js`
- Create: `desktop/build/icon.png` (cópia de `public/icon-512.png`)

**Interfaces:**
- Consumes: `desktop/webapp/out/index.html` (gerado pela Task 2).
- Produces: `window.electronApp = { isElectron: true, apiBaseUrl: string }`
  no contexto da página carregada — é exatamente o que `resolverUrlApi`
  (Task 1) já sabe ler.

- [ ] **Step 1: Copiar o ícone**

```bash
mkdir -p desktop/build
cp public/icon-512.png desktop/build/icon.png
```

- [ ] **Step 2: Criar `desktop/package.json`**

```json
{
  "name": "ntb-vendas-desktop",
  "version": "1.0.0",
  "private": true,
  "description": "Norte Vendas — app desktop (Windows)",
  "main": "electron/main.js",
  "scripts": {
    "build:web": "cd .. && npx next build desktop/webapp",
    "dev": "npm run build:web && electron .",
    "dist": "npm run build:web && electron-builder"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.1.8"
  },
  "dependencies": {
    "electron-updater": "^6.3.9"
  },
  "build": {
    "appId": "com.norteparanegocios.ntbvendas",
    "productName": "Norte Vendas",
    "directories": {
      "output": "dist"
    },
    "files": [
      "electron/**/*",
      "webapp/out/**/*"
    ],
    "win": {
      "target": "nsis",
      "icon": "build/icon.png"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true
    },
    "publish": {
      "provider": "generic",
      "url": "https://updates.norteparanegocios.com.br/ntb-vendas-desktop/"
    }
  }
}
```

- [ ] **Step 3: Criar `desktop/electron/preload.js`**

```js
const { contextBridge } = require('electron');

// Exposto como window.electronApp na página carregada — é isso que
// lib/api.ts:resolverUrlApi() lê pra decidir se resolve /api/* pra URL
// absoluta. contextIsolation:true (setado em main.js) garante que a
// página não pode alterar isso depois de carregada.
contextBridge.exposeInMainWorld('electronApp', {
  isElectron: true,
  apiBaseUrl: 'https://testvendase.norteparanegocios.com.br',
});
```

- [ ] **Step 4: Criar `desktop/electron/main.js`**

```js
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// Sem menu de navegador — "cara de PDV", não de app genérico.
Menu.setApplicationMenu(null);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const indexPath = path.join(__dirname, '..', 'webapp', 'out', 'index.html');
  win.loadFile(indexPath);

  return win;
}

app.whenReady().then(() => {
  createWindow();

  // Confere atualização ao abrir; baixa em background se houver, aplica
  // no próximo reinício (comportamento padrão do electron-updater, não
  // interrompe quem está no meio de uma venda).
  autoUpdater.checkForUpdatesAndNotify();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 5: Instalar as dependências do Electron**

```bash
cd desktop && npm install
```

- [ ] **Step 6: Rodar em modo dev e confirmar que abre**

```bash
npm run dev
```

Esperado: uma janela abre mostrando a tela `/acesso` (os dois botões
"Painel Master"/"Área do Lojista"), sem barra de navegador, sem menu.
Clicar em "Área do Lojista" deve navegar pra tela de login do `/loja`
DENTRO da mesma janela (é só um link `<Link href="/loja">` do Next.js,
funciona igual a navegação normal do site).

Fechar a janela (`Ctrl+C` no terminal, ou fechar a janela) antes do
próximo passo.

- [ ] **Step 7: Commit**

```bash
cd .. && git add desktop/package.json desktop/package-lock.json desktop/electron desktop/build/icon.png
git commit -m "feat: processo Electron (main.js/preload.js) — carrega o build estático local

Sem menu de navegador, ícone próprio, contextIsolation ligado. preload.js
expõe window.electronApp — é o que lib/api.ts:resolverUrlApi() usa pra
saber que está rodando dentro do app e resolver /api/* pra URL absoluta
de produção. electron-updater já plugado (checkForUpdatesAndNotify),
testado nesta task só localmente — a Task 4 monta o feed de atualização
de verdade."
```

---

## Task 4: Teste real de login + chamada `/api/*` de dentro do app empacotado

**Files:** nenhum arquivo novo — esta task é só verificação manual antes
de investir no empacotamento/distribuição (Task 5), confirmando que a
arquitetura (bundle local + API remota) funciona de ponta a ponta.

**Interfaces:**
- Consumes: tudo das Tasks 1-3.

- [ ] **Step 1: Rodar o app em modo dev**

```bash
cd desktop && npm run dev
```

- [ ] **Step 2: Login real na loja de teste**

Clicar "Área do Lojista", logar com a loja de teste ZZ Laboratorio
(mesmas credenciais já usadas em sessões anteriores deste projeto —
`qa-caixa-task4@zz-laboratorio.test`). Confirmar que o painel carrega
normalmente (mesas/balcão/cardápio aparecem, dado real vindo do
Supabase de produção pela janela do Electron).

- [ ] **Step 3: Exercitar uma chamada real de `/api/*` de dentro do app**

Ir em Administração → Notas Fiscais → "Certificado Digital", preencher
qualquer validade de teste (ex.: uma data futura) e clicar "Salvar
Certificado" (sem escolher arquivo — só a validade já dispara a chamada
a `/api/certificado`). Confirmar que aparece o toast de sucesso — isso
prova que `resolverUrlApi` está resolvendo a chamada pra
`https://testvendase.norteparanegocios.com.br/api/certificado` e o
servidor de produção respondeu, mesmo com a interface rodando 100%
local dentro do Electron.

Reverter a mudança de teste depois (deixar a validade como estava, ou
limpar via `node scripts/db.mjs` se necessário).

- [ ] **Step 4: Abrir o DevTools do Electron e confirmar a URL real da chamada**

Com o app aberto, `Ctrl+Shift+I` abre o DevTools do Chromium embutido
(funciona igual ao Chrome). Na aba Network, repetir o Step 3 e confirmar
que a requisição foi pra
`https://testvendase.norteparanegocios.com.br/api/certificado`, não pra
um caminho relativo.

- [ ] **Step 5: Registrar o resultado**

Sem commit nesta task (nenhum arquivo mudou) — só anotar no relatório
desta task que os 4 steps acima passaram, com o que foi observado no
Network tab do Step 4.

---

## Task 5: Empacotamento (electron-builder) + instalador `.exe`

**Files:** nenhum arquivo novo além do que a Task 3 já criou
(`desktop/package.json` já tem a config do `build`).

**Interfaces:**
- Consumes: `desktop/package.json` build config (Task 3).
- Produces: `desktop/dist/*.exe` (instalador NSIS) + `desktop/dist/latest.yml`
  (metadados de versão, consumidos pelo `autoUpdater` do lado cliente e
  pela Task 6, que publica os dois no servidor).

- [ ] **Step 1: Gerar o instalador**

```bash
cd desktop && npm run dist
```

Isso builda `desktop/webapp/out/` de novo (garante que está atualizado)
e roda `electron-builder`, que empacota tudo em
`desktop/dist/Norte Vendas Setup 1.0.0.exe` (o nome exato inclui a
versão do `package.json`).

- [ ] **Step 2: Confirmar os artefatos gerados**

```bash
ls desktop/dist/*.exe desktop/dist/latest.yml
```

Nota: `electron-builder` cross-compila `.exe` a partir de Mac/Linux
(usa Wine internamente) — não precisa rodar num Windows pra gerar o
instalador. **Testar o instalador em si** (rodar o `.exe`, confirmar
ícone/atalho/abre em tela cheia) exige uma máquina ou VM Windows real —
isso é o Step 3.

- [ ] **Step 3: Testar o instalador numa máquina/VM Windows**

Copiar `desktop/dist/*.exe` pra uma VM Windows (ou uma máquina real
disponível), rodar o instalador, confirmar:
- Ícone aparece corretamente na área de trabalho e no atalho criado.
- O app abre mostrando `/acesso`, sem barra de navegador visível.
- Repetir o login/teste da Task 4 (Steps 2-3) dentro do app instalado
  (não em modo dev) pra confirmar que o build de produção também
  resolve `/api/*` corretamente.

Se não houver VM/máquina Windows disponível nesta sessão, registrar
isso explicitamente no relatório desta task como pendência — não
marcar como testado sem essa confirmação.

- [ ] **Step 4: Adicionar `desktop/dist/` ao `.gitignore`**

O instalador e os artefatos de build não devem ir pro git (são
binários grandes, regenerados a cada `npm run dist`):

```bash
grep -q "^desktop/dist" .gitignore || echo "desktop/dist" >> .gitignore
grep -q "^desktop/node_modules" .gitignore || echo "desktop/node_modules" >> .gitignore
grep -q "^desktop/webapp/out" .gitignore || echo "desktop/webapp/out" >> .gitignore
grep -q "^desktop/webapp/.next" .gitignore || echo "desktop/webapp/.next" >> .gitignore
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "chore: ignora artefatos de build do app desktop (dist/, node_modules/, out/, .next/)"
```

---

## Task 6: Feed de atualização automática no Contabo + script de publicação

**Files:**
- Create: `desktop/scripts/publish.sh`

**Interfaces:**
- Consumes: `desktop/dist/*.exe` + `desktop/dist/latest.yml` (Task 5).
- Produces: os mesmos arquivos publicados em
  `https://updates.norteparanegocios.com.br/ntb-vendas-desktop/` — é a
  URL que `autoUpdater` (Task 3) já está configurado pra consultar.

**Nota de escopo:** os Steps 1-2 desta task mexem em infraestrutura do
Contabo (nginx, DNS) — são exatamente o tipo de mudança que pede
confirmação explícita antes de aplicar (efeito fora deste repositório).
Se estiver executando este plano via subagente, NÃO rode os Steps 1-2 —
pare e peça pro controlador confirmar com o usuário antes.

- [ ] **Step 1 (requer confirmação humana): criar o subdomínio e a pasta no Contabo**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "mkdir -p /var/www/updates-ntb-vendas-desktop"
```

Configurar `updates.norteparanegocios.com.br` (DNS apontando pro
`185.193.66.240`, mesmo padrão dos outros subdomínios já usados no
projeto) e um vhost nginx novo servindo
`/var/www/updates-ntb-vendas-desktop` como arquivo estático em
`/ntb-vendas-desktop/` — replicar o mesmo padrão de vhost estático já
usado nesta VPS pra outros serviços (confirmar com `nginx -t` antes de
recarregar).

- [ ] **Step 2 (requer confirmação humana): recarregar o nginx**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "nginx -t && systemctl reload nginx"
```

- [ ] **Step 3: Criar `desktop/scripts/publish.sh`**

```bash
#!/bin/bash
# Publica o instalador + latest.yml no feed de atualização do Contabo.
# Rodar depois de `npm run dist` (Task 5), da raiz de desktop/.
set -e

DIST_DIR="$(dirname "$0")/../dist"
REMOTE="root@185.193.66.240"
REMOTE_PATH="/var/www/updates-ntb-vendas-desktop"

if [ ! -f "$DIST_DIR/latest.yml" ]; then
  echo "latest.yml não encontrado em $DIST_DIR — rode 'npm run dist' primeiro."
  exit 1
fi

scp -i ~/.ssh/notebook_contabo_key "$DIST_DIR"/*.exe "$DIST_DIR/latest.yml" "$REMOTE:$REMOTE_PATH/"
echo "Publicado em https://updates.norteparanegocios.com.br/ntb-vendas-desktop/"
```

- [ ] **Step 4: Dar permissão de execução e testar (sem publicar de verdade se o Step 1-2 ainda não foi feito)**

```bash
chmod +x desktop/scripts/publish.sh
```

Se os Steps 1-2 já foram confirmados e aplicados: rodar
`bash desktop/scripts/publish.sh` e confirmar com `curl`:

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://updates.norteparanegocios.com.br/ntb-vendas-desktop/latest.yml
```

Esperado: `HTTP 200`.

- [ ] **Step 5: Commit**

```bash
git add desktop/scripts/publish.sh
git commit -m "feat: script de publicação do instalador no feed de atualização (Contabo)"
```

---

## Task 7: Teste real de atualização automática (v1 → v2)

**Files:**
- Modify: `desktop/package.json` (só o campo `version`, temporariamente,
  pra simular uma versão nova — reverter ao final)

**Interfaces:** nenhuma nova — esta task só valida que a Task 3
(`autoUpdater.checkForUpdatesAndNotify()`) e a Task 6 (feed publicado)
funcionam juntas de ponta a ponta.

**Pré-requisito:** Task 6 Steps 1-2 (subdomínio + nginx) já confirmados
e aplicados pelo controlador — sem isso, não tem feed real pra testar
contra.

- [ ] **Step 1: Instalar a v1 numa máquina/VM Windows**

Usar o instalador já gerado na Task 5 (`version: "1.0.0"`), instalar
numa VM/máquina Windows real. Abrir o app uma vez pra confirmar que
funciona (login, tela normal) e fechar.

- [ ] **Step 2: Gerar uma v2 de teste**

Na máquina de build (não na VM Windows), editar `desktop/package.json`:
trocar `"version": "1.0.0"` por `"version": "1.0.1"`. Rodar de novo:

```bash
cd desktop && npm run dist
bash scripts/publish.sh
```

- [ ] **Step 3: Confirmar que a v1 instalada detecta a atualização**

Abrir o app v1 já instalado na VM Windows (Step 1). O
`autoUpdater.checkForUpdatesAndNotify()` (Task 3) dispara ao abrir —
esperado: o app baixa a v1.0.1 em background (sem interromper o uso) e
aplica na próxima vez que o app for fechado e reaberto. Confirmar
reabrindo o app e checando a versão (pode adicionar temporariamente
`console.log(app.getVersion())` em `main.js` só pra este teste, ou
checar via `Ajuda > Sobre` se o `electron-builder` tiver gerado esse
menu — como o menu foi removido (`Menu.setApplicationMenu(null)`, Task
3), o jeito mais simples é abrir o DevTools e rodar
`require('electron').app.getVersion()` no console, ou simplesmente
confirmar pelo nome do arquivo baixado em
`%LOCALAPPDATA%\norte-vendas-updater\pending\`).

- [ ] **Step 4: Reverter a v2 de teste**

```bash
cd desktop
git checkout package.json
```

Republicar a v1.0.0 de volta no feed se o teste tiver sobrescrito o
`latest.yml` de produção com a v1.0.1 de teste:

```bash
npm run dist
bash scripts/publish.sh
```

- [ ] **Step 5: Registrar o resultado**

Sem commit nesta task além do revert do Step 4 (que não gera diff
nenhum, já que `git checkout` volta ao estado commitado) — anotar no
relatório se o auto-update funcionou de ponta a ponta, e se não, o que
foi observado (ex.: erro de assinatura de código — Windows pode exigir
o instalador ser assinado digitalmente pra o auto-update funcionar sem
aviso de segurança; se isso bloquear o teste, registrar como achado
real e não como falha do código, é uma decisão de negócio separada
sobre comprar um certificado de assinatura de código).
