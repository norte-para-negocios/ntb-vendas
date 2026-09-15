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

## Limitação conhecida do driver Bluetooth (escolha automática)

`BluetoothEscPosDriver` escolhe a primeira impressora pareada cujo nome
contenha "print" — não existe ainda uma tela pra escolher manualmente
entre várias pareadas. Se isso for um problema real (loja com mais de uma
impressora Bluetooth), vira uma task própria de UI.

## Limitação conhecida do driver Bluetooth (permissão nunca é pedida em runtime)

Achado na revisão de código da Task 6, ainda não corrigido.

`BluetoothEscPosDriver.temPermissao()`
(`mobile/android/app/src/main/java/com/norteparanegocios/ntbvendas/printer/BluetoothEscPosDriver.kt`)
só **verifica** se `BLUETOOTH_CONNECT` já foi concedida:

```kotlin
private fun temPermissao(): Boolean =
    ContextCompat.checkSelfPermission(context, "android.permission.BLUETOOTH_CONNECT") == PackageManager.PERMISSION_GRANTED
```

Isso confirma se a permissão já está concedida — mas em nenhum lugar do
código o app **pede** essa permissão em runtime. Em Android 12+ (API 31+),
`BLUETOOTH_CONNECT` é uma "dangerous permission": mesmo declarada no
`AndroidManifest.xml`, ela fica em estado "negada" até o usuário aprovar um
diálogo do sistema disparado explicitamente pelo app (`ActivityCompat.
requestPermissions` no Android puro, ou os métodos de permissão do próprio
framework de plugin no caso do Capacitor). Sem esse pedido, `checkSelfPermission`
nunca retorna `PERMISSION_GRANTED` sozinho — não existe "concessão automática"
por declarar no manifest.

**Correção 2026-09-14 — a limitação é mais grave do que "só Android 12+":**
o texto anterior dizia que o driver Bluetooth ficava morto "em qualquer
Android 12+". Isso estava incompleto. Conferindo o `AndroidManifest.xml`
(`mobile/android/app/src/main/AndroidManifest.xml`), o app declara
**apenas** `BLUETOOTH_CONNECT`/`BLUETOOTH_SCAN` — as permissões
específicas de Android 12+ (API 31+). Ele **não** declara as permissões
legadas exigidas em Android ANTERIOR ao 12 (API ≤ 30):
`android.permission.BLUETOOTH` e `android.permission.BLUETOOTH_ADMIN`
(ambas com `android:maxSdkVersion="30"`).

Ou seja: em Android ≤ 30 o app nem tem a permissão declarada no manifest
pra usar Bluetooth clássico (`BluetoothAdapter`/`bondedDevices`) — o
sistema operacional bloqueia de partida, antes mesmo de qualquer diálogo
de runtime entrar em jogo. Em Android 12+ a permissão legada não é
necessária, mas `BLUETOOTH_CONNECT` fica presa em "negada" pela ausência
do pedido runtime (limitação já documentada acima).

**Consequência prática, confirmada pela leitura do código (não é
hipotética): o driver Bluetooth está funcionalmente morto em QUALQUER
versão do Android hoje — não só nas mais novas —, mesmo com uma
impressora pareada de verdade.** Em Android ≤ 30 falta a permissão legada
no manifest; em Android 12+, `temPermissao()` sempre retorna `false` →
`dispositivoParaeado()` sempre retorna `null` → `isAvailable()` sempre
retorna `false` → `NtbPrinterPlugin.driverAtivo()` nunca escolhe esse
driver. Em ambos os casos o app cai direto no `PartnerDriverStub`,
reportando "impressora não configurada" num aparelho que teria impressora
de verdade disponível.

**Implementação completa precisaria de dois pedaços, não só um:**
1. Permissões legadas no manifest, só até API 30:
   ```xml
   <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
   <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
   ```
2. O fluxo de permissão runtime pro Android 12+ já documentado logo
   abaixo (`requestBluetoothPermission` via `@CapacitorPlugin`).
Sem os dois, o driver Bluetooth continua inoperante — um resolve só a
faixa de Android antiga, o outro só a faixa nova.

**Padrão de código que resolve** — usar o mecanismo nativo de permissão do
Capacitor 6, que evita reimplementar `ActivityCompat.requestPermissions`/
`onRequestPermissionsResult` na mão:

```kotlin
@CapacitorPlugin(
    name = "NtbPrinter",
    permissions = [
        Permission(strings = ["android.permission.BLUETOOTH_CONNECT"], alias = "bluetooth")
    ]
)
class NtbPrinterPlugin : Plugin() {

    // Novo método exposto ao JS: pede a permissão (o Capacitor só mostra o
    // diálogo do sistema se ainda não foi concedida nem definitivamente
    // negada; se já concedida, resolve na hora sem diálogo nenhum).
    @PluginMethod
    fun requestBluetoothPermission(call: PluginCall) {
        if (getPermissionState("bluetooth") == PermissionState.GRANTED) {
            val result = JSObject()
            result.put("granted", true)
            call.resolve(result)
            return
        }
        requestPermissionForAlias("bluetooth", call, "onBluetoothPermissionResult")
    }

    @PermissionCallback
    private fun onBluetoothPermissionResult(call: PluginCall) {
        val result = JSObject()
        result.put("granted", getPermissionState("bluetooth") == PermissionState.GRANTED)
        call.resolve(result)
    }

    // getStatus()/printText() continuam iguais — a diferença é só que,
    // depois do pedido acima ter sido aceito, temPermissao() no driver
    // finalmente pode retornar true.
}
```

E do lado JS (`lib/print.ts` ou onde o app chama o plugin pela primeira
vez): chamar `ntbPrinter.requestBluetoothPermission()` e aguardar a
resposta **antes** da primeira chamada a `getStatus()`/`printText()` no
Android — sem isso, o pedido de permissão nunca é disparado e o
comportamento observado hoje (driver sempre indisponível em Android 12+)
não muda, mesmo com o `@CapacitorPlugin` acima implementado.

Se a assinatura exata de `Permission`/`requestPermissionForAlias`/
`PermissionState`/`@PermissionCallback` tiver mudado na versão específica
do Capacitor usada neste projeto, conferir contra
`mobile/android/app/build.gradle` (versão do `@capacitor/android`) antes de
implementar — o padrão acima (anotar permissões no `@CapacitorPlugin`,
expor um método que chama `requestPermissionForAlias`, JS chama esse
método antes do primeiro uso) é o que vale independente da assinatura
exata.

## Comportamento conhecido: sem fallback quando o driver nativo falha

Achado na revisão de código da Task 7, ainda não corrigido.

`openThermalPrint` (`lib/print.ts`) só tenta o caminho HTML
(`printHtmlDocument`, que usa `window.print()`) quando `window.ntbPrinter`
**não existe**:

```ts
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

Se `window.ntbPrinter` existe (ou seja, o app está rodando como app Android
via Capacitor) mas `printText()` retorna `{ success: false }` ou lança uma
exceção, a função retorna `false` direto — ela **não** tenta o caminho HTML
como segunda tentativa. Em campo, isso significa: impressora desligada,
Sunmi com erro de hardware, Bluetooth sem permissão (ver limitação acima),
ou qualquer outra falha do driver nativo faz a impressão simplesmente não
sair, sem nenhum fallback pro `window.print()` que o mesmo aparelho
Android também é capaz de disparar (a WebView do Capacitor suporta
`window.print()` normalmente).

**Melhoria futura razoável (não implementada nesta task):** fazer
`openThermalPrint` tentar `printHtmlDocument` como segunda tentativa quando
o driver nativo retornar `success: false` (ou lançar), em vez de encerrar
ali. Ficaria algo como:

```ts
if (nativo && plainText) {
  try {
    const resultado = await nativo.printText({ text: plainText });
    if (resultado?.success) return true;
  } catch {
    // cai pro fallback abaixo
  }
  return printHtmlDocument(title, thermalStyles(paperWidthMm), bodyHtml);
}
return printHtmlDocument(title, thermalStyles(paperWidthMm), bodyHtml);
```

Não implementado agora porque está fora do escopo desta task (documentação)
e porque o comportamento de fallback correto depende de decidir, com o
dono do projeto, se um `window.print()` de emergência dentro da WebView do
app Android é aceitável em produção (ele abre o diálogo de impressão do
Android, não imprime direto na térmica) — decisão de produto, não só de
código.
