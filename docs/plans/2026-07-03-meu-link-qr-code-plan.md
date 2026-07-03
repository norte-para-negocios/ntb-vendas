# Meu Link / QR Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Lojista uma tela dedicada, dentro do painel de Administração, que mostra o link real do cardápio da própria loja e um QR Code gerado na hora, pronto pra copiar ou baixar como PNG.

**Architecture:** Um componente novo (`MeuLinkView`) recebe a `Store` já carregada por `StoreAdminView` e computa a URL no client via `window.location.origin`. O QR Code é desenhado direto num `<canvas>` pela lib `qrcode`, sem nenhuma rota de API nova e sem chamar serviço externo. O componente vira uma quarta sub-aba dentro de `StoreAdminView`, no mesmo padrão de abas (`activeTab`) que já existe ali.

**Tech Stack:** Next.js 16 (App Router, client component), React 19, TypeScript, lib `qrcode` ^1.5.4 (já usada em produção no projeto irmão `ntb-estoque-next`), Tailwind v4 (tokens `var(--...)` já usados em todo o projeto).

## Global Constraints

- A nova sub-aba só aparece no painel do Lojista (`StoreAdminView` em `components/modules/StoreModule.tsx`). Nunca adicionar nada equivalente no Master Admin (`AdminModule.tsx`).
- A URL do cardápio é sempre calculada via `window.location.origin` no client. Nunca hardcodear um domínio nem introduzir uma env var nova pra isso.
- QR Code é gerado 100% client-side com a lib `qrcode`. Nenhuma rota de API nova neste projeto (o projeto inteiro não tem API routes, ver `AGENTS.md`) e nenhum serviço de QR de terceiro.
- O download é só PNG (decisão explícita do usuário, sem opção de "imprimir" ou PDF nesta primeira versão).
- Este projeto não tem suite de testes automatizada. Verificação de cada tarefa é `npx tsc --noEmit` e `npm run build` limpos, mais teste manual no navegador (`npm run dev`, `http://localhost:3000/loja`).
- Testes manuais usam sempre a loja de demonstração ("Bistrô Demo", slug `bistro`) ou "Japanese". Nunca mexer em dado de loja real de cliente (o app local conecta no banco de produção real, ver `AGENTS.md`).
- Nenhum texto visível (rótulo de botão, mensagem de toast, texto de tela) usa travessão (—). Usar vírgula, ponto ou reescrever a frase.
- Todo texto novo em português correto, com acentuação completa.

---

### Task 1: Adicionar a dependência `qrcode`

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: o módulo `qrcode` (import `QRCode from 'qrcode'`) disponível para a Task 3 usar.

- [ ] **Step 1: Adicionar as dependências**

Em `package.json`, dentro de `"dependencies"` (ordem alfabética, entre `"next"` e `"react"` não se aplica aqui pois é `q` depois de `next`; manter ordem alfabética existente):

```json
    "next": "16.2.9",
    "qrcode": "^1.5.4",
    "react": "19.2.4",
```

E dentro de `"devDependencies"` (ordem alfabética, entre `"@types/react-dom"` e `"eslint"`):

```json
    "@types/react-dom": "^19",
    "@types/qrcode": "^1.5.6",
    "eslint": "^9",
```

Nota: isso deixa `@types/qrcode` fora da ordem alfabética estrita (viria antes de `@types/react`), mas a lista de `devDependencies` deste projeto já não é estritamente alfabética (`pg` aparece depois de `eslint-config-next`). Inserir na posição indicada acima é aceitável.

- [ ] **Step 2: Instalar**

Run: `npm install`
Expected: `qrcode` e `@types/qrcode` aparecem em `package-lock.json`, instalação sem erro.

- [ ] **Step 3: Verificar que o projeto ainda builda**

Run: `npx tsc --noEmit`
Expected: sem erros novos (o pacote ainda não é importado em lugar nenhum).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: adiciona dependencia qrcode para gerar QR Code client-side"
```

---

### Task 2: Criar MeuLinkView com link e botão de copiar, e ligar a nova aba

**Files:**
- Create: `components/modules/MeuLinkView.tsx`
- Modify: `components/modules/StoreModule.tsx:7-9` (imports)
- Modify: `components/modules/StoreModule.tsx:2724` (union type de `activeTab`)
- Modify: `components/modules/StoreModule.tsx:2937-2943` (botão da aba)
- Modify: `components/modules/StoreModule.tsx:2945-2947` (render condicional)

**Interfaces:**
- Produces: `export const MeuLinkView: React.FC<{ store: Store }>`, importável de `@/components/modules/MeuLinkView`.
- Consumes (de `StoreModule.tsx`): `store: Store` (já existe como prop de `StoreAdminView`, tipo `Store` de `@/types`, campos usados aqui: `store.name: string`, `store.slug: string`).
- Consumes (de `@/components/ui`): `Button`, `Card` (assinaturas já existentes em `components/ui.tsx`).
- Consumes (de `@/components/Toast`): `toast.success(msg: string)`, `toast.error(msg: string)` (já usado em todo o projeto, ex. `StoreModule.tsx:1953`).

- [ ] **Step 1: Criar o componente com URL, guarda de slug ausente e botão de copiar**

Criar `components/modules/MeuLinkView.tsx`:

```tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Link2, Copy } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { Store } from '@/types';
import { toast } from '@/components/Toast';

export const MeuLinkView: React.FC<{ store: Store }> = ({ store }) => {
    const [url, setUrl] = useState('');

    useEffect(() => {
        if (!store.slug) return;
        setUrl(`${window.location.origin}/c/${store.slug}`);
    }, [store.slug]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(url);
            toast.success('Link copiado!');
        } catch (error) {
            console.error('Erro ao copiar link', error);
            toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
        }
    };

    if (!store.slug) {
        return (
            <Card className="p-6">
                <p className="text-sm text-[var(--err)]">
                    Link da loja não configurado corretamente. Contate o suporte.
                </p>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <Card className="p-6 space-y-4">
                <div>
                    <h3 className="font-bold text-lg text-[var(--text)]">{store.name}</h3>
                    <p className="text-sm text-[var(--text-muted)] mt-1">
                        Este é o link do cardápio digital da sua loja. Compartilhe com os clientes ou gere um QR Code pra colocar nas mesas.
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-2)]">
                    <Link2 size={16} className="text-[var(--text-muted)] flex-shrink-0 hidden sm:block" />
                    <input
                        readOnly
                        value={url}
                        onFocus={(e) => e.target.select()}
                        className="flex-1 bg-transparent text-sm text-[var(--text)] outline-none min-w-0"
                    />
                    <Button size="sm" variant="outline" onClick={handleCopy}>
                        <Copy size={14} /> Copiar Link
                    </Button>
                </div>
            </Card>
        </div>
    );
};
```

- [ ] **Step 2: Importar o componente em `StoreModule.tsx`**

Em `components/modules/StoreModule.tsx`, na linha 8 (logo depois da linha de import de `@/lib/api`, que termina em `fetchStoreUserById`), adicionar antes da linha 9 (`import { OrderItem, ...`):

```tsx
import { MeuLinkView } from '@/components/modules/MeuLinkView';
```

- [ ] **Step 3: Adicionar `'link'` ao tipo de `activeTab`**

Em `components/modules/StoreModule.tsx:2724`, trocar:

```tsx
    const [activeTab, setActiveTab] = useState<'dashboard' | 'sales' | 'users'>('dashboard');
```

por:

```tsx
    const [activeTab, setActiveTab] = useState<'dashboard' | 'sales' | 'users' | 'link'>('dashboard');
```

- [ ] **Step 4: Adicionar o botão da aba**

Em `components/modules/StoreModule.tsx`, o bloco das abas (linhas 2937-2942) hoje é:

```tsx
                <button
                    onClick={() => setActiveTab('users')}
                    className={`pb-2 text-sm font-medium u-motion u-press-sm ${activeTab === 'users' ? 'border-b-2 border-[var(--brand)] text-[var(--brand)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                >
                    Gestão de Usuários
                </button>
            </div>
```

Trocar por (adiciona o botão da nova aba antes do fechamento do `<div>`):

```tsx
                <button
                    onClick={() => setActiveTab('users')}
                    className={`pb-2 text-sm font-medium u-motion u-press-sm ${activeTab === 'users' ? 'border-b-2 border-[var(--brand)] text-[var(--brand)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                >
                    Gestão de Usuários
                </button>
                <button
                    onClick={() => setActiveTab('link')}
                    className={`pb-2 text-sm font-medium u-motion u-press-sm ${activeTab === 'link' ? 'border-b-2 border-[var(--brand)] text-[var(--brand)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                >
                    Meu Link / QR Code
                </button>
            </div>
```

- [ ] **Step 5: Renderizar o componente na aba nova**

Em `components/modules/StoreModule.tsx:2947`, hoje:

```tsx
            {activeTab === 'users' && <UserManagementView storeId={storeId} />}
```

Trocar por:

```tsx
            {activeTab === 'users' && <UserManagementView storeId={storeId} />}

            {activeTab === 'link' && <MeuLinkView store={store} />}
```

- [ ] **Step 6: Verificar tipos e build**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 7: Teste manual**

Run: `npm run dev`, abrir `http://localhost:3000/loja`, logar na loja "Bistrô Demo", ir em Administração, clicar na aba "Meu Link / QR Code".
Expected: a tela mostra o nome da loja e o link `http://localhost:3000/c/bistro`. Clicar em "Copiar Link" mostra o toast "Link copiado!" e colar em outro campo (ex. a barra de endereço) confirma que o texto copiado é exatamente essa URL.

- [ ] **Step 8: Commit**

```bash
git add components/modules/MeuLinkView.tsx components/modules/StoreModule.tsx
git commit -m "feat: adiciona aba Meu Link com URL real da loja e botao de copiar"
```

---

### Task 3: Gerar o QR Code no canvas

**Files:**
- Modify: `components/modules/MeuLinkView.tsx`

**Interfaces:**
- Consumes: `QRCode.toCanvas(canvas: HTMLCanvasElement, text: string, options: { width?: number; margin?: number }): Promise<void>` da lib `qrcode` (instalada na Task 1).
- Produces: um `<canvas>` no DOM com o QR Code desenhado, que a Task 4 vai ler via `canvasRef.current.toDataURL(...)`.

- [ ] **Step 1: Adicionar o canvas e o efeito de geração**

Em `components/modules/MeuLinkView.tsx`, trocar o import do topo:

```tsx
import React, { useState, useEffect } from 'react';
```

por:

```tsx
import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
```

Trocar o corpo do componente (a partir da declaração de `const [url, setUrl] = useState('');`) de:

```tsx
    const [url, setUrl] = useState('');

    useEffect(() => {
        if (!store.slug) return;
        setUrl(`${window.location.origin}/c/${store.slug}`);
    }, [store.slug]);
```

por:

```tsx
    const [url, setUrl] = useState('');
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!store.slug) return;
        setUrl(`${window.location.origin}/c/${store.slug}`);
    }, [store.slug]);

    useEffect(() => {
        if (!url || !canvasRef.current) return;
        QRCode.toCanvas(canvasRef.current, url, { width: 240, margin: 2 }).catch((error) => {
            console.error('Erro ao gerar QR Code', error);
            toast.error('Não foi possível gerar o QR Code.');
        });
    }, [url]);
```

E adicionar o elemento `<canvas>` dentro do `<Card>`, logo depois do bloco do link (depois do `</div>` que fecha o bloco `flex flex-col sm:flex-row...` e antes do `</Card>` final):

```tsx
                <div className="flex flex-col items-center gap-4 pt-2 border-t border-[var(--border)]">
                    <canvas ref={canvasRef} className="rounded-[var(--r-md)] border border-[var(--border)]" />
                </div>
```

- [ ] **Step 2: Verificar tipos e build**

Run: `npx tsc --noEmit`
Expected: sem erros (o tipo de `QRCode.toCanvas` vem de `@types/qrcode`, instalado na Task 1).

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 3: Teste manual**

Run: `npm run dev`, abrir a aba "Meu Link / QR Code" na loja "Bistrô Demo".
Expected: um QR Code aparece abaixo do campo de link. Escanear com a câmera de um celular (ou um leitor de QR qualquer) mostra a mesma URL exibida no campo de texto.

- [ ] **Step 4: Commit**

```bash
git add components/modules/MeuLinkView.tsx
git commit -m "feat: gera QR Code do link da loja direto no canvas"
```

---

### Task 4: Botão de baixar o QR Code em PNG

**Files:**
- Modify: `components/modules/MeuLinkView.tsx`

**Interfaces:**
- Consumes: `canvasRef.current.toDataURL('image/png'): string` (API nativa do `HTMLCanvasElement`, sem lib adicional).

- [ ] **Step 1: Adicionar o handler de download e o botão**

Em `components/modules/MeuLinkView.tsx`, adicionar a função `handleDownload` logo depois de `handleCopy`:

```tsx
    const handleDownload = () => {
        if (!canvasRef.current) return;
        const link = document.createElement('a');
        link.download = `qrcode-${store.slug}.png`;
        link.href = canvasRef.current.toDataURL('image/png');
        link.click();
    };
```

E trocar o bloco do canvas (criado na Task 3):

```tsx
                <div className="flex flex-col items-center gap-4 pt-2 border-t border-[var(--border)]">
                    <canvas ref={canvasRef} className="rounded-[var(--r-md)] border border-[var(--border)]" />
                </div>
```

por:

```tsx
                <div className="flex flex-col items-center gap-4 pt-2 border-t border-[var(--border)]">
                    <canvas ref={canvasRef} className="rounded-[var(--r-md)] border border-[var(--border)]" />
                    <Button variant="primary" onClick={handleDownload}>
                        <Download size={16} /> Baixar QR Code (PNG)
                    </Button>
                </div>
```

E ajustar o import de ícones no topo do arquivo, de:

```tsx
import { Link2, Copy } from 'lucide-react';
```

para:

```tsx
import { Link2, Copy, Download } from 'lucide-react';
```

- [ ] **Step 2: Verificar tipos e build**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 3: Teste manual**

Run: `npm run dev`, abrir a aba "Meu Link / QR Code" na loja "Bistrô Demo", clicar em "Baixar QR Code (PNG)".
Expected: baixa um arquivo `qrcode-bistro.png`. Abrir o arquivo baixado confirma que é uma imagem PNG válida do QR Code mostrado na tela.

- [ ] **Step 4: Commit**

```bash
git add components/modules/MeuLinkView.tsx
git commit -m "feat: adiciona botao de baixar o QR Code em PNG"
```

---

### Task 5: Verificação final ponta a ponta

**Files:** nenhum arquivo novo, só verificação.

- [ ] **Step 1: Build completo**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpos, sem warnings novos.

- [ ] **Step 2: Fluxo completo na loja de demonstração**

Run: `npm run dev`, logar como Lojista na loja "Bistrô Demo" (slug `bistro`), ir em Administração > Meu Link / QR Code.

Expected, em sequência:
1. O link mostrado é exatamente `http://localhost:3000/c/bistro` (ou o domínio real, se testado em preview/produção).
2. "Copiar Link" copia esse texto exato pra área de transferência (testar colando em outro campo).
3. O QR Code renderizado no canvas escaneia (câmera de celular) e abre o cardápio da loja "Bistrô Demo" corretamente.
4. "Baixar QR Code (PNG)" baixa um PNG válido, e escanear o arquivo baixado (não só a tela) também abre o cardápio correto.

- [ ] **Step 3: Confirmar isolamento do Master Admin**

Abrir `http://localhost:3000/painel` e logar como Master Admin.
Expected: não existe nenhuma aba ou tela "Meu Link / QR Code" ali, a feature é exclusiva do painel `/loja`.

- [ ] **Step 4: Push**

```bash
git push
```
