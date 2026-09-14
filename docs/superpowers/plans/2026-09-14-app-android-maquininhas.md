# App Android (Capacitor) + Impressão em Maquininha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Goal:** Empacotar o NTB Vendas como app Android instalável (celular comum e maquininha Sunmi) e construir a estrutura de impressão nativa — com driver Sunmi funcional, driver Bluetooth ESC/POS genérico, e pontos de encaixe documentados para os SDKs de Stone/PagBank/Cielo/Getnet/Mercado Pago assim que o cadastro de parceiro sair.

**Architecture:** Mesmo truque já usado no app desktop: a exportação estática do Next (`output: 'export'`) é embrulhada numa casca nativa — lá era Electron, aqui é [Capacitor](https://capacitorjs.com/) (WebView + plugins nativos Kotlin). Um plugin Capacitor próprio (`NtbPrinterPlugin`) detecta o fabricante do aparelho em runtime e roteia para o driver certo: Sunmi (SDK público, aberto) ou Bluetooth ESC/POS genérico (fallback universal) hoje; PAX/Stone/PagBank/Cielo/Getnet ficam como *stubs* com interface pronta, porque cada um exige cadastro de parceiro que só o dono do projeto pode fazer (ver `docs/mobile-printer-drivers.md`, Task 8). Único ponto de encaixe no código já existente: `openThermalPrint` em `lib/print.ts`, que hoje é o único lugar por onde passam ticket de cozinha, comprovante e teste de impressão.

**Tech Stack:** Capacitor 6, Kotlin (Android), Next.js 16 (export estático, reaproveitando `app/loja`/`app/acesso` como `desktop/webapp` já faz), Android SDK (API 34, já instalado nesta máquina em `/opt/homebrew/share/android-commandlinetools`), Node 26.

**Spec:** Não existe documento de spec separado — este plano nasce do pedido direto do dono ("faz pra celular e pra maquininha, pra todas") e da pesquisa de mercado feita nesta sessão (2026-09-14) sobre SDK de impressora por fabricante/operadora, resumida na Task 8.

## Global Constraints

- **Este projeto NÃO tem framework de teste** (nem no lado Next, nem no lado Android). Verificação = `npx tsc --noEmit` (lado web), `./gradlew assembleDebug` (lado Android, compila = passou o mínimo), e teste AO VIVO no emulador.
- **Teste ao vivo no emulador usa o MESMO método já validado nesta sessão pro app desktop**: o WebView do Capacitor é Chromium normal, inspecionável via `chrome://inspect` — dá pra conectar por CDP (`WebSocket` contra `http://127.0.0.1:9222/json/list` depois de `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`) e rodar `Runtime.evaluate`, exatamente como foi feito com o app Electron. Prefira isso a tirar print manual.
- **SDK Android já instalado** em `/opt/homebrew/share/android-commandlinetools` (`platform-tools`, `platforms;android-34`, `build-tools;34.0.0`, licenças aceitas). Falta só o emulador (Task 1, Step 1).
- **NUNCA existiu, e não vai existir nesta sessão, hardware físico de maquininha** (Sunmi, PAX, etc.) nem impressora Bluetooth real disponível pra teste. Toda tarefa que mexe em driver de hardware real (Sunmi, Bluetooth) tem que dizer isso explicitamente no relatório — nunca fingir teste de papel saindo.
- **Loja de teste: `zz-laboratorio`** (`f33b4310-ff0a-487c-a3b1-62acd0a58850`). Usuário de QA: login `qa-caixa-task4@zz-laboratorio.test`, senha no cofre de credenciais (repo privado `chaves-apis-joaquim`) — nunca em documento commitado.
- **Nunca mexer em `lib/api.ts` pra resolver a URL da API.** `resolverUrlApi` já lê `window.electronApp?.isElectron`/`apiBaseUrl` — o app Android expõe esse MESMO shape (`window.electronApp`), então zero mudança no core web é necessária pra rotas/versão funcionarem no Android. Isso é intencional, não incidental.
- **`openThermalPrint` (`lib/print.ts`) é o único ponto de encaixe da impressão nativa.** Não duplicar lógica de impressão em outro lugar do código web.
- Comentário de código em português, explicando o PORQUÊ, no padrão já usado no repo (`desktop/electron/*.js` é a referência mais próxima).
- Deploy/instalação após cada tarefa testável: instalar o APK debug no emulador de novo e confirmar ao vivo — não empilhar tarefas sem ver rodando.
- Nunca commitar keystore, senha de keystore, nem chave de API de parceiro (Stone/PagBank/etc.) — essas vão pro cofre, nunca no repo.

---

## File Structure

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `mobile/webapp/app/{layout,page}.tsx`, `mobile/webapp/app/loja/page.tsx`, `mobile/webapp/next.config.ts`, `mobile/webapp/.env.local` (criar) | Reexporta a mesma árvore de páginas do projeto principal, exportação estática — mesmo padrão de `desktop/webapp/` | T1 |
| `mobile/capacitor.config.ts`, `mobile/package.json` (criar) | Configuração do projeto Capacitor | T1 |
| `mobile/android/` (gerado por `npx cap add android`, depois customizado) | Projeto Android nativo | T1, T4, T5, T6, T9 |
| `mobile/webapp/app/NtbBridgeInit.tsx` (criar) | Expõe `window.electronApp` (isElectron/apiBaseUrl/version) e `window.ntbPrinter` (wrapper JS do plugin nativo) | T2 |
| `mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/printer/NtbPrinterPlugin.kt` (criar) | Plugin Capacitor: detecta fabricante, roteia pro driver certo, responde `getStatus`/`printText` | T4 |
| `mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/printer/PrinterDriver.kt` (criar) | Interface comum que todo driver implementa | T4 |
| `mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/printer/SunmiDriver.kt` (criar) | Driver Sunmi via AIDL (`com.sunmi:printerlibrary`) | T5 |
| `mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/printer/BluetoothEscPosDriver.kt` (criar) | Driver Bluetooth SPP genérico, protocolo ESC/POS | T6 |
| `mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/printer/PartnerDriverStub.kt` (criar) | Stub documentado — PAX/Stone/PagBank/Cielo/Getnet/Mercado Pago | T8 |
| `lib/escpos.ts` (criar) | Codificador ESC/POS puro (texto → bytes, corte de papel) — usado pelo driver Bluetooth | T3 |
| `lib/print.ts` (modificar) | `openThermalPrint` ganha parâmetro `plainText?` e tenta `window.ntbPrinter` antes do HTML | T7 |
| `docs/mobile-printer-drivers.md` (criar) | Cadastro necessário por operadora (links, prazo, o que preencher) + como plugar um driver novo | T8 |

---

### Task 1: Scaffold do projeto Capacitor + emulador rodando

**Files:**
- Create: `mobile/package.json`, `mobile/capacitor.config.ts`
- Create: `mobile/webapp/app/layout.tsx`, `mobile/webapp/app/page.tsx`, `mobile/webapp/app/loja/page.tsx`, `mobile/webapp/app/acesso/page.tsx`, `mobile/webapp/next.config.ts`, `mobile/webapp/.env.local`, `mobile/webapp/tsconfig.json`
- Create: `mobile/android/` (gerado, depois versionado)

**Interfaces:**
- Consumes: nada (primeira tarefa).
- Produces: comando `npm run build:web` (dentro de `mobile/`) gerando `mobile/webapp/out/`; `npx cap sync android` copiando isso pra `mobile/android/app/src/main/assets/public/`; um AVD chamado `ntb_test` rodando localhost.

- [ ] **Step 1: Instalar o emulador Android**

```bash
SDK=/opt/homebrew/share/android-commandlinetools
"$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" "system-images;android-34;google_apis;arm64-v8a" "emulator"
"$SDK/cmdline-tools/latest/bin/avdmanager" create avd -n ntb_test -k "system-images;android-34;google_apis;arm64-v8a" -d pixel_6 --force
"$SDK/emulator/emulator" -avd ntb_test -no-window -no-audio -no-boot-anim &
"$SDK/platform-tools/adb" wait-for-device
"$SDK/platform-tools/adb" shell getprop sys.boot_completed
```

Run até a última linha devolver `1` (pode levar alguns minutos no boot frio). `arm64-v8a` é o correto pra Mac Apple Silicon (roda nativo, sem emulação de instrução — `x86_64` seria muito mais lento aqui).

- [ ] **Step 2: Criar `mobile/package.json`**

```json
{
  "name": "ntb-vendas-mobile",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build:web": "cd .. && npx next build mobile/webapp",
    "dev": "npm run build:web && npx cap sync android",
    "android": "npx cap open android"
  },
  "dependencies": {
    "@capacitor/android": "^6.2.0",
    "@capacitor/core": "^6.2.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.2.0"
  }
}
```

- [ ] **Step 3: Criar `mobile/webapp/next.config.ts`** (idêntico em espírito ao de `desktop/webapp`, mesmo motivo)

```ts
import type { NextConfig } from 'next';

// Build estático — Capacitor serve os arquivos de dentro do WebView via
// file:// (scheme customizado `capacitor://`, na prática), igual ao app
// desktop serve via `app://`. Sem servidor rodando dentro do celular.
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
```

- [ ] **Step 4: Criar as páginas reexportadas** (mesmo padrão de `desktop/webapp/app/`)

`mobile/webapp/app/layout.tsx`:
```tsx
export { metadata, viewport, default } from '@/app/layout';
```

`mobile/webapp/app/page.tsx`:
```tsx
export { default } from '@/app/acesso/page';
```

`mobile/webapp/app/loja/page.tsx`:
```tsx
export { metadata, default } from '@/app/loja/page';
```

`mobile/webapp/app/acesso/page.tsx`:
```tsx
export { metadata, default } from '@/app/acesso/page';
```

`mobile/webapp/.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://testvendase.norteparanegocios.com.br
NEXT_PUBLIC_SUPABASE_ANON_KEY=<copiar o mesmo valor de desktop/webapp/.env.local>
```

`mobile/webapp/tsconfig.json` (copiar de `desktop/webapp/tsconfig.json` — mesmo `paths` apontando `@/*` pra raiz do repo).

- [ ] **Step 5: Buildar e confirmar a exportação estática**

Run: `cd mobile && npm install && npm run build:web`
Expected: `mobile/webapp/out/index.html`, `mobile/webapp/out/loja/index.html`, `mobile/webapp/out/acesso/index.html` existem. `npx tsc --noEmit` limpo na raiz do repo (a página reexportada não introduz tipo novo).

- [ ] **Step 6: Criar `mobile/capacitor.config.ts` e adicionar a plataforma Android**

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.norteparanegocios.ntbvendas',
  appName: 'Norte Vendas',
  webDir: 'webapp/out',
};

export default config;
```

Run:
```bash
cd mobile
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
npx cap add android
npx cap sync android
```

- [ ] **Step 7: Compilar e instalar no emulador**

```bash
cd mobile/android
./gradlew assembleDebug
/opt/homebrew/share/android-commandlinetools/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
/opt/homebrew/share/android-commandlinetools/platform-tools/adb shell am start -n com.norteparanegocios.ntbvendas/.MainActivity
```

- [ ] **Step 8: Provar AO VIVO via CDP que a tela carregou**

```bash
adb=/opt/homebrew/share/android-commandlinetools/platform-tools/adb
$adb forward tcp:9222 localabstract:chrome_devtools_remote  # nome exato do socket varia; confirmar com:
$adb shell cat /proc/net/unix | grep devtools
```
Ajuste o `forward` pro socket real listado (geralmente `webview_devtools_remote_<pid>` pro WebView do app, não `chrome_devtools_remote`, que é do Chrome do sistema). Depois:
```bash
curl -s http://127.0.0.1:9222/json/list
```
Pegue o `webSocketDebuggerUrl` da página e rode `Runtime.evaluate` com `document.title` e `document.body.innerText.slice(0,120)` (mesmo script `cdp.js` usado pro app desktop nesta sessão, adaptado). Esperado: título "Área do Lojista | Cardápio Digital" (a landing `/acesso`) ou o texto da tela de login.

- [ ] **Step 9: Commit**

```bash
git add mobile/
git commit -m "feat(mobile): scaffold do app Android via Capacitor, reaproveitando a exportacao estatica"
```

---

### Task 2: Bridge — `window.electronApp` e versão visível

**Files:**
- Create: `mobile/webapp/app/NtbBridgeInit.tsx`
- Modify: `mobile/webapp/app/layout.tsx`

**Interfaces:**
- Consumes: `resolverUrlApi`/`window.electronApp` já existentes em `lib/api.ts` (não modificados) — o app web já lê esse shape.
- Produces: `window.electronApp = { isElectron: true, apiBaseUrl: string, version: string }` disponível a partir do primeiro paint, e `window.ntbPrinter` (placeholder nesta tarefa, implementado de verdade na Task 4).

- [ ] **Step 1: Criar o componente de inicialização**

```tsx
'use client';

import { useEffect } from 'react';

// Mesmo truque do preload.js do app desktop (Electron): `lib/api.ts` já lê
// `window.electronApp?.isElectron`/`apiBaseUrl` pra resolver rota de API e
// mostrar a versão na sidebar — reaproveitar esse MESMO shape aqui evita
// qualquer mudança em lib/api.ts. `isElectron: true` é proposital (não
// criamos uma flag nova tipo `isAndroid`): o app web só faz UMA pergunta
// hoje — "estou rodando embutido numa casca nativa, ou no navegador
// solto?" — e a resposta é a mesma nos dois casos (usar apiBaseUrl
// absoluto em vez de caminho relativo).
//
// Roda num useEffect (não script inline no <head>) porque a página
// hidrata rápido o bastante aqui — diferente do preload do Electron, que
// PRECISA rodar antes de qualquer script da página (é código de outro
// processo, isolado). Aqui é tudo o mesmo processo JS.
export function NtbBridgeInit() {
  useEffect(() => {
    (window as any).electronApp = {
      isElectron: true,
      apiBaseUrl: 'https://testvendase.norteparanegocios.com.br',
      // Versão do app (não do bundle web) — lida do <meta> injetado no
      // build (ver Task 9, Step 3). Sem o <meta>, cai num valor visível
      // de "não configurado" em vez de undefined silencioso.
      version: document.querySelector('meta[name="ntb-app-version"]')?.getAttribute('content') || '0.0.0-dev',
    };
  }, []);

  return null;
}
```

- [ ] **Step 2: Montar no layout do app mobile**

`mobile/webapp/app/layout.tsx` deixa de ser um reexport puro (precisa injetar o componente antes do resto renderizar):

```tsx
import RootLayout, { metadata, viewport } from '@/app/layout';
import { NtbBridgeInit } from './NtbBridgeInit';

export { metadata, viewport };

// Não dá mais pra reexportar `default` puro (Task 1, Step 4) — precisamos
// injetar o bridge ANTES do conteúdo. RootLayout do projeto principal já
// envolve os children com <html>/<body>; aqui só acrescentamos o
// componente de inicialização como primeiro filho.
export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <RootLayout>
      <NtbBridgeInit />
      {children}
    </RootLayout>
  );
}
```

Confirmado lendo `app/layout.tsx` da raiz: `RootLayout` é uma função normal `({ children }: { children: React.ReactNode })` que renderiza `<html><body><AppProvider>{children}</AppProvider>...</body></html>` — aceita `children` como qualquer `ReactNode`, então `<NtbBridgeInit />{children}` no código acima funciona sem ajuste nenhum.

- [ ] **Step 3: Rebuild e reinstalar**

```bash
cd mobile && npm run dev  # build:web + cap sync
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.norteparanegocios.ntbvendas/.MainActivity
```

- [ ] **Step 4: Provar AO VIVO via CDP**

Login como `qa-caixa-task4@zz-laboratorio.test` na tela `/loja` (via `Runtime.evaluate` preenchendo os campos e clicando, mesmo script usado pro app desktop). Depois rodar:
```js
window.electronApp
```
Esperado: `{ isElectron: true, apiBaseUrl: "https://testvendase.norteparanegocios.com.br", version: "0.0.0-dev" }`. Confirmar também que a sidebar do painel mostra "App v0.0.0-dev" (o mesmo texto que `StoreModule.tsx` já renderiza pra `window.electronApp.version`, sem nenhuma mudança lá).

- [ ] **Step 5: Commit**

```bash
git add mobile/webapp/app/NtbBridgeInit.tsx mobile/webapp/app/layout.tsx
git commit -m "feat(mobile): bridge window.electronApp para reaproveitar resolverUrlApi/versao sem tocar lib/api.ts"
```

---

### Task 3: Codificador ESC/POS puro

**Files:**
- Create: `lib/escpos.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `buildEscPosBytes(text: string, opts?: { cutPaper?: boolean }): Uint8Array` — consumido pelo driver Bluetooth (Task 6) e pelo plugin nativo via ponte JSON (bytes viajam como array de números ou base64, decidido na Task 4).

- [ ] **Step 1: Escrever a função**

```ts
// Protocolo ESC/POS: o padrão de fato pra impressora térmica de recibo —
// toda impressora Bluetooth genérica (as que NÃO são Sunmi/PAX/etc, ex.
// qualquer térmica de 58mm comprada solta) fala esse protocolo. Aqui só a
// parte mínima: inicializar, mandar texto puro (a loja já formata a
// largura de coluna certa em lib/print.ts, isso aqui só converte pra
// bytes) e cortar o papel no fim.
const ESC = 0x1b;
const GS = 0x1d;

// Inicializa a impressora (limpa buffer/formatação residual de um job
// anterior — sem isso, um corte de papel no meio de uma sessão anterior
// podia deixar a impressora num modo de fonte/alinhamento estranho pro
// próximo ticket).
const INIT = [ESC, 0x40];

// Corte parcial de papel (GS V 1) — "parcial" deixa uma tira ligando as
// duas partes, physicamente mais fácil de destacar na mão do que corte
// total; é o padrão usado pela maioria das térmicas de balcão.
const CUT_PARTIAL = [GS, 0x56, 0x01];

export function buildEscPosBytes(text: string, opts?: { cutPaper?: boolean }): Uint8Array {
  const encoder = new TextEncoder();
  // ESC/POS térmica brasileira normalmente usa CP860/CP850 (Latin), mas
  // sem acesso a hardware real pra confirmar a code page de cada
  // impressora Bluetooth possível, manter UTF-8 aqui é a escolha honesta:
  // acento pode sair errado em ALGUMAS térmicas mais antigas, mas nunca
  // trava a impressão inteira (diferente de mandar bytes numa code page
  // que a impressora não reconhece, que pode gerar lixo ilegível igual).
  // Revisitar com uma impressora real na mão antes de considerar isso
  // definitivo — ver docs/mobile-printer-drivers.md.
  const textBytes = Array.from(encoder.encode(text + '\n\n\n'));
  const bytes = [...INIT, ...textBytes, ...(opts?.cutPaper !== false ? CUT_PARTIAL : [])];
  return new Uint8Array(bytes);
}
```

- [ ] **Step 2: Verificar sem framework de teste — script Node comparando bytes esperados**

```bash
node --input-type=module -e "
import { buildEscPosBytes } from './lib/escpos.ts';
" 2>&1 | head -5
```

Isso vai falhar (Node não roda `.ts` direto sem transpilar). Em vez disso, verifique via `npx tsx`:
```bash
npx tsx --eval "
import { buildEscPosBytes } from './lib/escpos.ts';
const bytes = buildEscPosBytes('OI');
console.log(Array.from(bytes));
console.log('comeca com ESC @:', bytes[0] === 0x1b && bytes[1] === 0x40);
console.log('termina com corte GS V 1:', bytes.at(-3) === 0x1d && bytes.at(-2) === 0x56 && bytes.at(-1) === 0x01);
const semCorte = buildEscPosBytes('OI', { cutPaper: false });
console.log('sem corte nao termina em GS V:', semCorte.at(-3) !== 0x1d);
"
```
Expected: as três linhas de log confirmando `true`.

- [ ] **Step 3: Commit**

```bash
git add lib/escpos.ts
git commit -m "feat(mobile): codificador ESC/POS puro para impressora Bluetooth generica"
```

---

### Task 4: Plugin nativo `NtbPrinterPlugin` — detecção de fabricante e roteamento

**Files:**
- Create: `mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/printer/PrinterDriver.kt`
- Create: `mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/printer/NtbPrinterPlugin.kt`
- Modify: `mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/MainActivity.java` (ou `.kt`, o que o `cap add android` gerar)

**Interfaces:**
- Consumes: nada de tarefa anterior no lado Kotlin.
- Produces: interface `PrinterDriver { fun isAvailable(): Boolean; fun printText(text: String): Result<Unit> }`, implementada por `SunmiDriver` (Task 5), `BluetoothEscPosDriver` (Task 6), `PartnerDriverStub` (Task 8). JS: `window.ntbPrinter.getStatus(): Promise<{driver: string, manufacturer: string, available: boolean}>` e `window.ntbPrinter.printText(text: string): Promise<{success: boolean, message?: string}>`.

- [ ] **Step 1: Interface comum dos drivers**

```kotlin
package com.norteparanegocios.ntbvendas.printer

// Todo driver de impressora (Sunmi, Bluetooth genérico, ou o SDK de uma
// operadora quando o cadastro de parceiro sair — ver PartnerDriverStub)
// implementa isto. `isAvailable()` nunca deve lançar exceção — sempre
// `false` em caso de dúvida, porque é chamado no boot do app pra decidir
// qual driver mostrar como "impressora deste aparelho".
interface PrinterDriver {
    val nome: String
    fun isAvailable(): Boolean
    fun printText(texto: String): Result<Unit>
}
```

- [ ] **Step 2: O plugin em si — detecta fabricante, escolhe driver**

```kotlin
package com.norteparanegocios.ntbvendas.printer

import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

// Ponto único de decisão "qual impressora este aparelho tem": olha
// Build.MANUFACTURER (Sunmi sempre reporta "SUNMI" aqui, confirmado na
// documentação pública do SDK) e cai pro Bluetooth genérico como
// fallback universal — nunca falha em silêncio: se nenhum driver está
// disponível, `getStatus()` diz isso explicitamente ("unsupported"), a
// tela de configuração de impressora mostra essa string pro lojista em
// vez de simplesmente não imprimir sem explicação nenhuma.
@CapacitorPlugin(name = "NtbPrinter")
class NtbPrinterPlugin : Plugin() {

    private fun driverAtivo(): PrinterDriver {
        val fabricante = Build.MANUFACTURER.uppercase()
        val candidatos: List<PrinterDriver> = listOf(
            SunmiDriver(context),
            // Bluetooth genérico é sempre candidato, mas só "disponível"
            // se existir um dispositivo pareado — ver Task 6.
            BluetoothEscPosDriver(context),
        )
        // Primeiro que responder isAvailable()=true vence. Sunmi primeiro
        // na lista de propósito: um Sunmi também pode ter impressora
        // Bluetooth pareada por engano/teste, e a impressora EMBUTIDA é
        // sempre a certa nesse aparelho.
        return candidatos.firstOrNull { it.isAvailable() }
            ?: PartnerDriverStub(fabricante)
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val driver = driverAtivo()
        val result = JSObject()
        result.put("driver", driver.nome)
        result.put("manufacturer", Build.MANUFACTURER)
        result.put("available", driver.isAvailable())
        call.resolve(result)
    }

    @PluginMethod
    fun printText(call: PluginCall) {
        val texto = call.getString("text")
        if (texto == null) {
            call.reject("Parametro 'text' ausente.")
            return
        }
        val driver = driverAtivo()
        val resultado = driver.printText(texto)
        val json = JSObject()
        if (resultado.isSuccess) {
            json.put("success", true)
        } else {
            json.put("success", false)
            json.put("message", resultado.exceptionOrNull()?.message ?: "Falha desconhecida no driver ${driver.nome}.")
        }
        call.resolve(json)
    }
}
```

- [ ] **Step 3: `PartnerDriverStub` mínimo (versão completa/documentada é a Task 8)**

```kotlin
package com.norteparanegocios.ntbvendas.printer

// Existe pra NUNCA deixar `driverAtivo()` sem retorno. Sempre reporta
// indisponível, com o nome do fabricante real no motivo — é isso que
// aparece pro lojista quando o aparelho é uma maquininha de operadora
// (Stone/PagBank/Cielo/Getnet) cujo SDK ainda não foi integrado (exige
// cadastro de parceiro, ver docs/mobile-printer-drivers.md).
class PartnerDriverStub(private val fabricante: String) : PrinterDriver {
    override val nome = "unsupported"
    override fun isAvailable() = false
    override fun printText(texto: String): Result<Unit> =
        Result.failure(Exception("Impressora deste aparelho ($fabricante) ainda não tem driver configurado. Ver docs/mobile-printer-drivers.md."))
}
```

- [ ] **Step 4: Registrar o plugin em `MainActivity`**

Abra o arquivo gerado por `cap add android` (`mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/MainActivity.java`) e adicione, antes de `super.onCreate`:

```java
import com.norteparanegocios.ntbvendas.printer.NtbPrinterPlugin;
// ...
registerPlugin(NtbPrinterPlugin.class);
```

(Sintaxe exata depende do template do Capacitor 6 — confirme olhando o arquivo gerado; `registerPlugin` é chamado dentro de `onCreate`, antes de `super.onCreate(savedInstanceState)`.)

- [ ] **Step 5: Expor no JS (dentro de `NtbBridgeInit.tsx`, Task 2)**

```tsx
import { registerPlugin } from '@capacitor/core';

interface NtbPrinterPlugin {
  getStatus(): Promise<{ driver: string; manufacturer: string; available: boolean }>;
  printText(opts: { text: string }): Promise<{ success: boolean; message?: string }>;
}

const NtbPrinter = registerPlugin<NtbPrinterPlugin>('NtbPrinter');

// Dentro do useEffect de NtbBridgeInit, junto do window.electronApp:
(window as any).ntbPrinter = NtbPrinter;
```

Precisa de `@capacitor/core` instalado em `mobile/package.json` (já está, Task 1).

- [ ] **Step 6: Compilar, instalar, provar ao vivo (emulador reporta "unsupported" — é o esperado, emulador não é Sunmi)**

```bash
cd mobile && npm run dev
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.norteparanegocios.ntbvendas/.MainActivity
```
Via CDP, rodar `await window.ntbPrinter.getStatus()`. Esperado: `{ driver: "unsupported", manufacturer: "Google", available: false }` — o emulador do AVD reporta `Build.MANUFACTURER = "Google"`, então cair no stub é o comportamento CORRETO aqui, não uma falha. Isso prova o roteamento sem precisar de hardware real.

- [ ] **Step 7: Commit**

```bash
git add mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/printer/ mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/MainActivity.java mobile/webapp/app/NtbBridgeInit.tsx
git commit -m "feat(mobile): plugin nativo de impressao com deteccao de fabricante e stub de operadora"
```

---

### Task 5: Driver Sunmi

**Files:**
- Modify: `mobile/android/app/build.gradle` (dependência)
- Create: `mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/printer/SunmiDriver.kt`

**Interfaces:**
- Consumes: `PrinterDriver` (Task 4).
- Produces: nada que outra tarefa consuma.

- [ ] **Step 1: Adicionar a dependência (pública, Maven Central, sem cadastro)**

Em `mobile/android/app/build.gradle`, dentro de `dependencies {}`:
```gradle
implementation 'com.sunmi:printerlibrary:1.0.18'
```

- [ ] **Step 2: Implementar o driver**

```kotlin
package com.norteparanegocios.ntbvendas.printer

import android.content.Context
import android.os.Build
import com.sunmi.peripheral.printer.InnerPrinterCallback
import com.sunmi.peripheral.printer.InnerPrinterManager
import com.sunmi.peripheral.printer.SunmiPrinterService

// SDK público (Maven Central, sem cadastro/parceria — ver pesquisa de
// 2026-09-14 em docs/mobile-printer-drivers.md). `isAvailable()` só
// confirma o FABRICANTE via Build.MANUFACTURER: o bind de verdade com o
// serviço da impressora (via AIDL, InnerPrinterManager) é assíncrono e só
// é tentado dentro de printText — não faz sentido manter uma conexão
// aberta o tempo todo só pra responder "disponível?" no boot do app.
class SunmiDriver(private val context: Context) : PrinterDriver {
    override val nome = "sunmi"

    override fun isAvailable(): Boolean = Build.MANUFACTURER.equals("SUNMI", ignoreCase = true)

    override fun printText(texto: String): Result<Unit> {
        var printerService: SunmiPrinterService? = null
        val latch = java.util.concurrent.CountDownLatch(1)
        var erro: Exception? = null

        val callback = object : InnerPrinterCallback() {
            override fun onConnected(service: SunmiPrinterService) {
                printerService = service
                latch.countDown()
            }
            override fun onDisconnected() {
                latch.countDown()
            }
        }

        return try {
            val conectou = InnerPrinterManager.getInstance().bindService(context, callback)
            if (!conectou) return Result.failure(Exception("Nao foi possivel iniciar a conexao com o servico de impressao Sunmi."))
            // Timeout de 3s: o bind AIDL costuma resolver em milissegundos
            // num Sunmi de verdade; 3s é folga generosa sem travar a UI
            // pra sempre se o serviço do sistema estiver quebrado.
            if (!latch.await(3, java.util.concurrent.TimeUnit.SECONDS)) {
                return Result.failure(Exception("Timeout esperando o servico de impressao Sunmi responder."))
            }
            val servico = printerService ?: return Result.failure(Exception("Servico de impressao Sunmi nao conectou."))
            servico.printText(texto + "\n\n\n", null)
            servico.cutPaper(null)
            Result.success(Unit)
        } catch (e: Exception) {
            erro = e
            Result.failure(e)
        } finally {
            try { InnerPrinterManager.getInstance().unBindService(context, callback) } catch (_: Exception) {}
        }
    }
}
```

- [ ] **Step 2: Compilar (mínimo verificável sem hardware)**

```bash
cd mobile/android && ./gradlew assembleDebug
```
Expected: BUILD SUCCESSFUL. `com.sunmi:printerlibrary` resolve do Maven Central sem exigir credencial nenhuma — se o Gradle reclamar de repositório, confirme que `mobile/android/build.gradle` tem `mavenCentral()` na lista de `repositories` (o template padrão do Capacitor já inclui).

- [ ] **Step 3: Instalar no emulador e confirmar que NÃO tenta o caminho Sunmi (emulador não é Sunmi)**

Mesmo teste da Task 4 Step 6 — `getStatus()` continua devolvendo `manufacturer: "Google"`, `driver: "unsupported"`. **Isto é o teto do que dá pra verificar sem o aparelho físico.** Documente isso, sem exceção, no relatório desta tarefa: "compilado e presente no roteamento, mas `printText` do SunmiDriver nunca foi de fato exercitado contra hardware real."

- [ ] **Step 4: Commit**

```bash
git add mobile/android/app/build.gradle mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/printer/SunmiDriver.kt
git commit -m "feat(mobile): driver Sunmi via AIDL (SDK publico, nao testado em hardware real)"
```

---

### Task 6: Driver Bluetooth ESC/POS genérico

**Files:**
- Create: `mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/printer/BluetoothEscPosDriver.kt`
- Modify: `mobile/android/app/src/main/AndroidManifest.xml` (permissões)

**Interfaces:**
- Consumes: `PrinterDriver` (Task 4). O texto chega em `printText(texto: String)` — a conversão pra bytes ESC/POS acontece NO LADO KOTLIN (não reaproveita `lib/escpos.ts` diretamente, já que esse é código Kotlin/nativo; a Task 3 documenta a MESMA lógica pro lado JS, usado caso um driver de operadora receba bytes prontos do JS em vez de texto — ver Task 8).

- [ ] **Step 1: Permissões no manifest**

Em `mobile/android/app/src/main/AndroidManifest.xml`, dentro de `<manifest>`, antes de `<application>`:
```xml
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
```
(API 31+ exige essas duas em vez do antigo `BLUETOOTH`/`BLUETOOTH_ADMIN` — o `minSdkVersion` do template Capacitor 6 já é 22+, mas o app roda em Android moderno o suficiente pra precisar das novas.)

- [ ] **Step 2: Implementar o driver**

```kotlin
package com.norteparanegocios.ntbvendas.printer

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import java.io.OutputStream
import java.util.UUID

// Fallback universal: QUALQUER impressora térmica Bluetooth (não-Sunmi,
// não integrada a operadora nenhuma) fala ESC/POS por uma porta serial
// (SPP) — este UUID é o padrão fixo do perfil SPP, não específico de
// marca nenhuma.
private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

class BluetoothEscPosDriver(private val context: Context) : PrinterDriver {
    override val nome = "bluetooth"

    private fun temPermissao(): Boolean =
        ContextCompat.checkSelfPermission(context, "android.permission.BLUETOOTH_CONNECT") == PackageManager.PERMISSION_GRANTED

    private fun dispositivoParaeado(): BluetoothDevice? {
        if (!temPermissao()) return null
        val adapter = BluetoothAdapter.getDefaultAdapter() ?: return null
        if (!adapter.isEnabled) return null
        // Heurística simples: primeira impressora pareada cujo nome
        // contenha "print" (a maioria dos fabricantes genéricos nomeia
        // assim — ex. "BlueTooth Printer", "POS-58"). Sem uma tela de
        // "escolher impressora pareada" ainda (fora de escopo desta
        // task), é o melhor palpite automático; a Task 8 registra a
        // limitação de UX disso.
        return adapter.bondedDevices?.firstOrNull {
            it.name?.contains("print", ignoreCase = true) == true
        }
    }

    // "Disponível" aqui significa "existe candidato pareado" — não abre
    // conexão de verdade só pra checar (isso é lento e pode falhar por
    // motivo transitório); a tentativa de conexão de fato acontece em
    // printText.
    override fun isAvailable(): Boolean = dispositivoParaeado() != null

    override fun printText(texto: String): Result<Unit> {
        val device = dispositivoParaeado()
            ?: return Result.failure(Exception("Nenhuma impressora Bluetooth pareada encontrada (nome precisa conter 'print')."))
        var socket: BluetoothSocket? = null
        return try {
            socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
            BluetoothAdapter.getDefaultAdapter()?.cancelDiscovery()
            socket.connect()
            val bytes = buildEscPosBytesKotlin(texto)
            socket.outputStream.write(bytes)
            socket.outputStream.flush()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        } finally {
            try { socket?.close() } catch (_: Exception) {}
        }
    }
}

// Mesma lógica de lib/escpos.ts (Task 3), reimplementada em Kotlin porque
// este driver roda no processo nativo, sem acesso ao runtime JS. Manter
// as duas em sincronia manualmente é aceito aqui — são ~10 linhas cada.
private fun buildEscPosBytesKotlin(texto: String): ByteArray {
    val init = byteArrayOf(0x1b, 0x40)
    val corte = byteArrayOf(0x1d, 0x56, 0x01)
    val corpo = (texto + "\n\n\n").toByteArray(Charsets.UTF_8)
    return init + corpo + corte
}
```

- [ ] **Step 3: Compilar**

```bash
cd mobile/android && ./gradlew assembleDebug
```

- [ ] **Step 4: Provar o que dá pra provar sem hardware — `isAvailable()` retorna `false` honestamente**

Instalar no emulador (mesmo processo das tarefas anteriores). Emulador Android não tem rádio Bluetooth funcional por padrão. Via CDP, `await window.ntbPrinter.getStatus()` continua devolvendo `unsupported` — confirma que o Bluetooth driver não finge disponibilidade que não existe. **Documentar explicitamente no relatório**: nenhuma impressora Bluetooth real foi pareada nem testada; a lógica de conexão SPP/escrita de bytes está implementada mas não exercitada contra hardware.

- [ ] **Step 5: Commit**

```bash
git add mobile/android/app/src/main/AndroidManifest.xml mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/printer/BluetoothEscPosDriver.kt
git commit -m "feat(mobile): driver Bluetooth ESC/POS generico (fallback universal, nao testado em hardware real)"
```

---

### Task 7: Hook único em `lib/print.ts` — usa o driver nativo antes do HTML

**Files:**
- Modify: `lib/print.ts` (`openThermalPrint`, `printKitchenTicket`, `printBillReceipt`, `printGenericTestTicket`)

**Interfaces:**
- Consumes: `window.ntbPrinter.printText({text}): Promise<{success, message?}>` (Task 4/5/6). `buildKitchenTicketText`, `buildBillReceiptText`, `buildGenericTestTicketText` (já existem em `lib/print.ts`, usadas hoje só pelo caminho de fila do desktop — `enqueuePrintJob`).
- Produces: nada que outra tarefa consuma — é a ponta final da cadeia.

- [ ] **Step 1: Ler o `openThermalPrint` atual e confirmar que é mesmo o único ponto**

```bash
grep -n "openThermalPrint(" lib/print.ts
```
Esperado: usado só dentro de `printKitchenTicket`, `printBillReceipt`, `printGenericTestTicket` (as 3 funções de ticket térmico — `printSalesReport`, A4, não passa por aqui e não deve: relatório de vendas não faz sentido numa impressora de 48/58/80mm de maquininha).

- [ ] **Step 2: Adicionar o parâmetro `plainText` e o desvio nativo**

```ts
// Ponto único de saída de qualquer ticket térmico (cozinha/bar,
// comprovante de mesa/balcão, teste de impressão). No app Android
// (Capacitor), `window.ntbPrinter` existe e sabe falar com a impressora
// de verdade do aparelho (embutida na maquininha, ou Bluetooth pareada)
// — nesse caso, pula o iframe/window.print() (que nem existe de verdade
// numa WebView sem diálogo do sistema por trás) e manda o TEXTO PURO pro
// driver nativo. No navegador normal e no app desktop, `window.ntbPrinter`
// não existe, e o caminho de sempre (HTML + window.print()) continua
// intacto — nenhuma mudança de comportamento pra quem já usa o sistema.
async function openThermalPrint(title: string, bodyHtml: string, paperWidthMm?: 48 | 58 | 80, plainText?: string): Promise<boolean> {
  const nativo = (typeof window !== 'undefined') ? (window as any).ntbPrinter : undefined;
  if (nativo && plainText) {
    try {
      const resultado = await nativo.printText({ text: plainText });
      return !!resultado?.success;
    } catch {
      return false;
    }
  }
  return printHtmlDocument(title, thermalStyles(paperWidthMm), bodyHtml);
}
```

- [ ] **Step 3: Atualizar os 3 chamadores pra passar `plainText`**

Em `printKitchenTicket`, antes do `return openThermalPrint(...)`, monte o texto com a função que já existe:
```ts
const plainText = buildKitchenTicketText({
  kind: opts.kind, storeName: opts.storeName, orderType: opts.orderType, identifier: opts.identifier,
  client: opts.client, quantity: opts.quantity, productName: opts.productName, addons: opts.addons,
  observation: opts.observation, orderIdShort: opts.orderIdShort, paperWidthMm: opts.paperWidthMm ?? 48,
});
return openThermalPrint(`Ticket - ${opts.kind}`, body, opts.paperWidthMm, plainText);
```
(Confirme a assinatura exata de `buildKitchenTicketText` lendo o arquivo — os nomes de campo têm que bater 1:1 com `opts` de `printKitchenTicket`, que já compartilham a maioria dos nomes por serem literalmente a mesma informação em dois formatos.)

Em `printBillReceipt`, mesma ideia com `buildBillReceiptText(opts)`.

Em `printGenericTestTicket`, `buildGenericTestTicketText(paperWidthMm, storeName)` já existe e já é chamada por outro caminho — só passe o resultado como `plainText` também aqui.

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erro. `openThermalPrint` virou `async` — confirme que os 3 chamadores já dão `return openThermalPrint(...)` dentro de função `async`/`Promise<boolean>` (já são, por já retornarem uma Promise antes desta mudança).

- [ ] **Step 5: Provar ao vivo — teste de impressão do app mobile chamando o driver nativo**

No emulador, logado como `qa-caixa-task4@zz-laboratorio.test`, ir em Administração → Impressão, cadastrar uma impressora com `connection_type: browser_default` e clicar "Imprimir teste". Antes desta task, isso chamava `printGenericTestTicket` → `window.print()` (que numa WebView sem diálogo do sistema por trás simplesmente não faz nada visível). Depois desta task, o mesmo clique deve chamar `window.ntbPrinter.printText(...)` — confirme via CDP com um breakpoint/log temporário, ou lendo `adb logcat | grep NtbPrinter` (o stub `PartnerDriverStub`/roteamento loga o motivo da falha, que aparece no logcat do Android). Esperado: a chamada chega no driver nativo e retorna a mensagem "Impressora deste aparelho (Google) ainda não tem driver configurado" (porque o emulador não é Sunmi) — a PROVA aqui é que o caminho nativo foi acionado, não que papel saiu.

- [ ] **Step 6: Commit**

```bash
git add lib/print.ts
git commit -m "feat(mobile): openThermalPrint tenta o driver nativo antes do window.print()"
```

---

### Task 8: Documentação de cadastro por operadora + stub completo

**Files:**
- Create: `docs/mobile-printer-drivers.md`
- Modify: `mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/printer/PartnerDriverStub.kt` (mensagens específicas por fabricante detectado)

**Interfaces:**
- Consumes: `PrinterDriver` (Task 4).
- Produces: nada que outra tarefa consuma — é o documento que o dono do projeto usa pra saber o que cadastrar.

- [ ] **Step 1: Escrever o documento**

```markdown
# Drivers de impressora por operadora de maquininha

Pesquisa feita em 2026-09-14. Cada linha é uma operadora/fabricante e o
que falta pra ligar a impressora térmica embutida da maquininha dela ao
app. **Nenhuma dessas integrações está pronta** — o app hoje sabe
imprimir em: (1) Sunmi (SDK público, funciona assim que o app roda numa
Sunmi de verdade) e (2) qualquer impressora Bluetooth genérica pareada
(fallback universal, protocolo ESC/POS).

| Operadora/fabricante | Cadastro necessário | Link | Observação |
|---|---|---|---|
| Sunmi | Nenhum — SDK público, já integrado | — | Funciona hoje, sem ação nenhuma |
| Mercado Pago (Point Smart) | Conta de desenvolvedor grátis, self-service | https://www.mercadopago.com.br/developers | O mais fácil de liberar |
| Stone/Ton (cobre também Positivo L300/L400) | Formulário de parceiro | https://sdkpos.stone.com.br/docs/quero-ser-parceiro-stone | |
| PagBank (Moderninha Smart/Pro) | Conta no portal + contato com gerente comercial pra liberar modo debug | https://developer.pagbank.com.br | SDK (PlugPag) é open-source, mas o aparelho vem travado até a liberação comercial |
| Cielo LIO | Conta de parceiro | https://desenvolvedores.cielo.com.br/api-portal/pt-br/content/sdk-cielo-lio | |
| Getnet | Cadastro na Get Store + e-mail | parceiros_posdigital@getnet.com.br, https://getstore.getnet.com.br | |

## Como plugar um driver novo quando o cadastro sair

1. Implementar `PrinterDriver` (`mobile/android/app/src/main/java/.../printer/PrinterDriver.kt`) — só `isAvailable()` e `printText(texto)`.
2. Adicionar a instância na lista `candidatos` de `NtbPrinterPlugin.driverAtivo()`.
3. Adicionar a dependência (`.aar`/Maven privado da operadora) em `mobile/android/app/build.gradle`.
4. Guardar qualquer chave/credencial de parceiro no cofre (`chaves-apis-joaquim`), nunca no repo.
5. Testar no aparelho físico — nenhum desses SDKs funciona no emulador (são bindings de hardware real).

## Limitação conhecida do driver Bluetooth

`BluetoothEscPosDriver` escolhe a primeira impressora pareada cujo nome
contenha "print" — não existe ainda uma tela pra escolher manualmente
entre várias pareadas. Se isso for um problema real (loja com mais de uma
impressora Bluetooth), vira uma task própria de UI.
```

- [ ] **Step 2: Refinar `PartnerDriverStub` pra citar o documento e o fabricante certo**

Já feito na Task 4, Step 3 — confirme que a mensagem cita `docs/mobile-printer-drivers.md` (já cita). Sem mudança de código adicional aqui, só a confirmação.

- [ ] **Step 3: Commit**

```bash
git add docs/mobile-printer-drivers.md
git commit -m "docs(mobile): cadastro necessario por operadora + como plugar driver novo"
```

---

### Task 9: Empacotar debug APK instalável fora do emulador

**Files:**
- Create: `mobile/android/app/debug.keystore` — **NÃO COMMITAR** (adicionar ao `.gitignore` do repo).
- Modify: `.gitignore` (raiz do repo)
- Create: `mobile/webapp/app/NtbVersionMeta.tsx` (ou ajuste em `NtbBridgeInit`, ver Task 2 Step 1 — o `<meta>` que a Task 2 lê precisa ser gerado por algo)

**Interfaces:**
- Consumes: `NtbBridgeInit` (Task 2) lê `meta[name="ntb-app-version"]`.
- Produces: `mobile/android/app/build/outputs/apk/debug/app-debug.apk` instalável em qualquer Android via `adb install` ou copiando o arquivo pro aparelho.

- [ ] **Step 1: Adicionar o `.gitignore`**

```
# app mobile — build gerado + keystore de debug (nunca commitar)
/mobile/webapp/.next/
/mobile/webapp/out/
/mobile/android/app/build/
/mobile/android/build/
/mobile/android/.gradle/
/mobile/android/app/*.keystore
```

- [ ] **Step 2: Injetar a versão real no HTML exportado**

`mobile/webapp/app/layout.tsx` (o `MobileLayout` da Task 2) sobrescreve o `metadata` reexportado, acrescentando o campo `other` (que o Next injeta como `<meta name="..." content="...">` extra no `<head>`) com a versão lida de `mobile/package.json` — não do `package.json` da raiz, que é o do Next principal e não tem relação com a versão do app mobile:

```tsx
import RootLayout, { metadata as baseMetadata, viewport } from '@/app/layout';
import { NtbBridgeInit } from './NtbBridgeInit';
import mobilePackageJson from '../../package.json';

export const metadata = {
  ...baseMetadata,
  other: { 'ntb-app-version': mobilePackageJson.version },
};
export { viewport };

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <RootLayout>
      <NtbBridgeInit />
      {children}
    </RootLayout>
  );
}
```

Isso substitui por completo o `MobileLayout` escrito na Task 2 Step 2 (mesma função, agora com o `metadata` de versão também).

- [ ] **Step 3: Build final e instalação fora do emulador (physical device via USB, se o dono tiver um Android à mão) ou apenas confirmar o artefato**

```bash
cd mobile && npm run dev
cd android && ./gradlew assembleDebug
ls -la app/build/outputs/apk/debug/app-debug.apk
```
Se houver um celular Android físico disponível E autorizado via `adb` (Configurações → Opções do desenvolvedor → Depuração USB), `adb install -r app/build/outputs/apk/debug/app-debug.apk` e confirmar visualmente que abre. **Se não houver aparelho físico disponível nesta sessão**, documente isso e valide só no emulador (já feito nas tarefas anteriores) — não é motivo pra bloquear a tarefa, é uma limitação a registrar, igual foi feito com o app desktop nunca testado em Windows real.

- [ ] **Step 4: Commit**

```bash
git add .gitignore mobile/webapp/app/layout.tsx
git commit -m "chore(mobile): versao real no build + gitignore do keystore/build gerado"
```

---

## Encerramento (depois da última tarefa)

- [ ] Rodar `npx tsc --noEmit` uma última vez na raiz do repo.
- [ ] Confirmar que `mobile/android/app/debug.keystore` (se existir) está fora do git: `git status --short | grep keystore` deve devolver vazio.
- [ ] Encerrar o emulador: `adb emu kill`.
- [ ] Resumo final pro dono: quais operadoras já funcionam (Sunmi, Bluetooth genérico) e quais dependem de ele preencher cadastro (link exato de cada uma, `docs/mobile-printer-drivers.md`).

## Fora deste plano (registrado de propósito)

- **Teste em hardware físico de qualquer tipo** (Sunmi, PAX, impressora Bluetooth real, celular Android físico) — nada disso existe nesta sessão. Todo driver de hardware fica "compilado e roteado corretamente, nunca exercitado contra dispositivo real" até alguém testar com o aparelho na mão.
- **Publicação na Play Store** — exige conta de desenvolvedor Google ($25 único, cadastro do dono) e política de privacidade pública; não pedido ainda.
- **Assinatura de release (keystore de produção)** — o debug build serve pra instalar via `adb`/sideload; distribuição via Play Store exigiria gerar e guardar um keystore de release à parte, no cofre.
- **Tela de escolher impressora Bluetooth entre várias pareadas** — registrado como limitação conhecida em `docs/mobile-printer-drivers.md`.
- **Integração de fato com Stone/PagBank/Cielo/Getnet** — bloqueada em cadastro de parceiro que só o dono do projeto pode fazer; a estrutura (`PrinterDriver`, lista de candidatos) já está pronta pra receber cada uma assim que sair.
