# Contingência Fiscal (NFC-e Offline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando a transmissão pra SEFAZ falhar por rede (não por rejeição de negócio), emitir a NFC-e em modo de contingência (`tpEmis=9`), imprimir um cupom de contingência em 2 vias na hora, e retransmitir automaticamente pra SEFAZ quando a conexão voltar.

**Architecture:** Uma nova classificação de erro em `app/api/fiscal/emitir/route.ts` (transporte vs. negócio) desvia pro caminho de contingência, que gera um XML com `tpEmis=9` e um PDF próprio (sem depender de protocolo). Um job em background (`setInterval`, iniciado via `instrumentation.ts` do Next.js) reprocessa periodicamente as notas em contingência, reaproveitando a mesma função de "finalizar autorização" já usada no caminho síncrono normal.

**Tech Stack:** Next.js 16 (App Router), Supabase self-hosted (Postgres), `node-forge` (certificado), `pdfkit` (PDF de contingência), SOAP direto via `node:https` (já existente).

**Spec:** `docs/superpowers/specs/2026-09-15-contingencia-fiscal-design.md`

## Global Constraints

- **Nunca emitir nota fiscal real durante teste** — sempre confirmar `store_fiscal_config.ambiente = 'homologacao'` antes de qualquer teste ao vivo que dispare `transmitirNota` de verdade (regra permanente do projeto, ver AGENTS.md).
- Uma rejeição de **negócio** da SEFAZ (resposta chegou, `cStat` presente e ≠ `100`) NUNCA vira contingência — só falha de **transporte** (exceção lançada por `transmitirNota`, ou resposta chegou mas `cStat` veio `null`).
- A partir do momento em que uma nota tem `status IN ('autorizada', 'contingencia')`, um documento com chave de acesso já existe e foi (ou pode ter sido) entregue ao cliente em papel — nenhuma lógica posterior pode apagar essa linha nem trocar a chave.
- `npx tsc --noEmit` limpo antes de cada commit (convenção do projeto, sem test runner configurado).
- Deploy: `git push` + `ssh ... "bash /opt/ntb-vendas/deploy.sh"` no Contabo depois de cada task testada (convenção já estabelecida do projeto — nunca só no fim).

---

### Task 1: Migration — status `contingencia` + coluna `xml_contingencia`

**Files:**
- Create: `supabase/migrations/075_fiscal_notas_contingencia.sql`

**Interfaces:**
- Produces: `fiscal_notas.status` aceita `'contingencia'`; `fiscal_notas.xml_contingencia` (text, nullable) guarda o XML assinado com `tpEmis=9`, reenviado tal e qual pela retransmissão (Task 7).

- [ ] **Step 1: Escrever a migration**

```sql
-- Contingência fiscal NFC-e offline (2026-09-15, pedido ao vivo loja
-- Sertão): quando a SEFAZ/internet cai, a nota é emitida com tpEmis=9 e
-- fica pendente de retransmissão — precisa de um status novo e de um
-- lugar pra guardar o XML assinado que será reenviado depois.
alter table fiscal_notas drop constraint if exists fiscal_notas_status_check;
alter table fiscal_notas add constraint fiscal_notas_status_check
  check (status in ('pendente', 'autorizada', 'rejeitada', 'erro', 'contingencia'));

alter table fiscal_notas add column if not exists xml_contingencia text;
```

- [ ] **Step 2: Aplicar no Contabo**

```bash
scp -i ~/.ssh/notebook_contabo_key supabase/migrations/075_fiscal_notas_contingencia.sql root@185.193.66.240:/tmp/075.sql
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas < /tmp/075.sql && docker exec supabase-db psql -U supabase_admin -d ntb_vendas -c \"NOTIFY pgrst, 'reload schema';\""
```

- [ ] **Step 3: Verificar**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d ntb_vendas -c \"\\d fiscal_notas\" | grep -i xml_contingencia"
```
Esperado: a coluna aparece na listagem.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/075_fiscal_notas_contingencia.sql
git commit -m "feat(fiscal): migration pra status contingencia + xml_contingencia"
```

---

### Task 2: `tpEmis` parametrizável na chave de acesso e no XML

**Files:**
- Modify: `lib/fiscal/xml.ts:201` (chamada a `montarChaveAcesso`), `lib/fiscal/xml.ts:371` (`<tpEmis>1</tpEmis>` hardcoded), assinatura de `montarXmlNota`.

**Interfaces:**
- Consumes: `montarChaveAcesso(dados: DadosChaveAcesso)` já aceita `tpEmis?: number` (default `1`) — nada muda em `lib/fiscal/chaveAcesso.ts`.
- Produces: `montarXmlNota` ganha um campo opcional `tpEmis?: number` (default `1`) no seu parâmetro de entrada — Task 5 vai chamar com `tpEmis: 9`.

- [ ] **Step 1: Ler a assinatura atual de `montarXmlNota`**

```bash
grep -n "export function montarXmlNota" -A 15 lib/fiscal/xml.ts
```
Confirme o nome exato da interface do parâmetro (algo como `DadosNota` ou inline) antes do próximo passo — use o mesmo nome no diff.

- [ ] **Step 2: Adicionar `tpEmis?: number` na interface de entrada**

Na interface de parâmetros de `montarXmlNota` (a mesma que já tem `modelo`, `ambiente`, `serie`, `numero`, `emitente`, `itens`, `destinatario?`, `pagamentos?`), adicione:

```typescript
  // Contingência offline (2026-09-15): 1 = emissão normal (default), 9 =
  // contingência (SEFAZ/rede inacessível no momento da venda). Repassado
  // pra montarChaveAcesso E pro grupo <ide> do XML — os dois precisam
  // bater, senão a chave de acesso calculada não corresponde ao que o XML
  // declara.
  tpEmis?: number;
```

- [ ] **Step 3: Passar pra `montarChaveAcesso`**

Na chamada existente (linha ~201):

```typescript
  const { chave, cNF } = montarChaveAcesso({
    cUF,
    anoMes,
    cnpj: emitente.cnpj,
    modelo,
    serie,
    numero,
    tpEmis: dados.tpEmis ?? 1,
  });
```

(troque `dados` pelo nome real do parâmetro de entrada de `montarXmlNota`, confirmado no Step 1 — se os campos já vierem desestruturados, adicione `tpEmis` na desestruturação também.)

- [ ] **Step 4: Trocar o `<tpEmis>1</tpEmis>` hardcoded**

Linha ~371:

```typescript
    `<tpImp>${modelo === '65' ? 4 : 1}</tpImp><tpEmis>${dados.tpEmis ?? 1}</tpEmis><cDV>${chave.slice(-1)}</cDV>` +
```

- [ ] **Step 5: Verificar que nada quebrou**

```bash
npx tsc --noEmit
```
Esperado: limpo. Nenhum call site de `montarXmlNota` precisa mudar (parâmetro é opcional, default `1` reproduz o comportamento de hoje).

- [ ] **Step 6: Commit**

```bash
git add lib/fiscal/xml.ts
git commit -m "feat(fiscal): tpEmis parametrizavel (prepara contingencia)"
```

---

### Task 3: Extrair `salvarNotaAutorizada` (compartilhado entre emissão síncrona e retransmissão)

**Por que esta task existe:** a Fase 2 de `app/api/fiscal/emitir/route.ts` (montar `nfeProc`, gerar PDF, subir 2 arquivos pro Storage, gravar `fiscal_notas`, marcar `order_items.fiscal_nota_id`) precisa rodar em DOIS lugares: na emissão síncrona de hoje (INSERT de uma linha nova) e na retransmissão em background da Task 7 (UPDATE de uma linha `contingencia` já existente). Extrair agora evita duplicar ~60 linhas e correr risco de as duas cópias divergirem com o tempo.

**Files:**
- Create: `lib/fiscal/salvarNotaAutorizada.ts`
- Modify: `app/api/fiscal/emitir/route.ts` (troca a Fase 2 inline pela chamada à função nova)

**Interfaces:**
- Produces:
```typescript
export interface DadosNotaAutorizada {
  storeId: string;
  modelo: '55' | '65';
  chave: string;
  numero: number;
  serie: number;
  xmlAssinado: string; // com <infNFeSupl> já inserido, se NFC-e
  protocoloXmlBruto: string; // resposta.xmlBruto de transmitirNota — de onde extrai <protNFe>
  protocolo: string;
  valorTotalComTaxa: number;
  notaBase: Record<string, unknown>; // campos comuns já montados por quem chama (order_id, table_id, ambiente, etc.)
  itensValidos: { id: string }[];
  // Se informado, faz UPDATE nesta linha (caminho de retransmissão);
  // se ausente, faz INSERT de uma linha nova (caminho síncrono de hoje).
  notaIdExistente?: string;
}

export async function salvarNotaAutorizada(dados: DadosNotaAutorizada): Promise<{ notaId: string | null }>;
```

- [ ] **Step 1: Ler o bloco Fase 2 completo, pra copiar exato**

```bash
sed -n '648,730p' app/api/fiscal/emitir/route.ts
```
(o trecho começa em `// FASE 2` e termina depois do bloco que atualiza `order_items.fiscal_nota_id`.)

- [ ] **Step 2: Criar `lib/fiscal/salvarNotaAutorizada.ts`**

```typescript
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { gerarPdfNota, montarNfeProc } from '@/lib/fiscal/pdf';

export interface DadosNotaAutorizada {
  storeId: string;
  modelo: '55' | '65';
  chave: string;
  numero: number;
  serie: number;
  xmlAssinado: string;
  protocoloXmlBruto: string;
  protocolo: string;
  valorTotalComTaxa: number;
  notaBase: Record<string, unknown>;
  itensValidos: { id: string }[];
  notaIdExistente?: string;
}

// Fase 2 da emissão fiscal: nota JÁ autorizada na SEFAZ (cStat=100),
// nada aqui pode mudar o status pra 'erro'/'rejeitada' (ver comentário
// original em app/api/fiscal/emitir/route.ts). Compartilhado entre a
// emissão síncrona (INSERT, notaIdExistente ausente) e a retransmissão
// em background de uma nota que nasceu em contingência (UPDATE,
// notaIdExistente = id da linha 'contingencia' já existente).
export async function salvarNotaAutorizada(dados: DadosNotaAutorizada): Promise<{ notaId: string | null }> {
  const admin = getSupabaseAdmin();
  let xmlPath: string | null = null;
  let pdfPath: string | null = null;
  let motivoPosAutorizacao: string | null = null;

  try {
    const protXml = dados.protocoloXmlBruto.match(/<protNFe[\s\S]*?<\/protNFe>/)?.[0] ?? '';
    const nfeProc = montarNfeProc(dados.xmlAssinado, protXml);
    const pdfBuffer = await gerarPdfNota(dados.modelo, nfeProc);

    const caminhoXml = `${dados.storeId}/${dados.chave}.xml`;
    const caminhoPdf = `${dados.storeId}/${dados.chave}.pdf`;
    const [uploadXml, uploadPdf] = await Promise.all([
      admin.storage.from('fiscal-documentos').upload(caminhoXml, nfeProc, { contentType: 'application/xml', upsert: true }),
      admin.storage.from('fiscal-documentos').upload(caminhoPdf, pdfBuffer, { contentType: 'application/pdf', upsert: true }),
    ]);
    if (uploadXml.error) throw uploadXml.error;
    if (uploadPdf.error) throw uploadPdf.error;

    xmlPath = caminhoXml;
    pdfPath = caminhoPdf;
  } catch (e) {
    motivoPosAutorizacao = `Autorizada na SEFAZ mas falha ao gerar/salvar PDF: ${
      e instanceof Error ? e.message : 'erro desconhecido'
    }`;
    console.error('salvarNotaAutorizada: pós-processamento (PDF/storage) falhou:', e);
  }

  const linha = {
    ...dados.notaBase,
    valor_total: dados.valorTotalComTaxa,
    status: 'autorizada' as const,
    chave_acesso: dados.chave,
    numero: dados.numero,
    serie: dados.serie,
    protocolo: dados.protocolo,
    xml_path: xmlPath,
    pdf_path: pdfPath,
    motivo_erro: motivoPosAutorizacao,
  };

  const query = dados.notaIdExistente
    ? admin.from('fiscal_notas').update(linha).eq('id', dados.notaIdExistente).select('id').single()
    : admin.from('fiscal_notas').insert(linha).select('id').single();

  const { data: notaSalva, error: salvarErr } = await query;
  if (salvarErr) {
    console.error(
      `salvarNotaAutorizada: nota AUTORIZADA (chave=${dados.chave}, protocolo=${dados.protocolo}) mas falha ao gravar fiscal_notas:`,
      salvarErr,
    );
    return { notaId: null };
  }

  const { error: marcarErr } = await admin
    .from('order_items')
    .update({ fiscal_nota_id: notaSalva.id })
    .in('id', dados.itensValidos.map((i) => i.id));
  if (marcarErr) {
    console.error(
      `salvarNotaAutorizada: nota AUTORIZADA (chave=${dados.chave}) mas falha ao marcar order_items.fiscal_nota_id=${notaSalva.id}:`,
      marcarErr,
    );
  }

  return { notaId: notaSalva.id };
}
```

- [ ] **Step 3: Trocar a Fase 2 inline de `app/api/fiscal/emitir/route.ts` pela chamada à função nova**

Substitua todo o bloco lido no Step 1 (do comentário `// FASE 2` até o fim do `if/else` de `order_items.fiscal_nota_id`) por:

```typescript
  await salvarNotaAutorizada({
    storeId,
    modelo,
    chave,
    numero,
    serie,
    xmlAssinado,
    protocoloXmlBruto: resposta.xmlBruto,
    protocolo: resposta.protocolo!,
    valorTotalComTaxa,
    notaBase,
    itensValidos,
  });
```

Adicione o import no topo do arquivo:
```typescript
import { salvarNotaAutorizada } from '@/lib/fiscal/salvarNotaAutorizada';
```

Remova os imports que só existiam pra Fase 2 e não são mais usados neste arquivo (`gerarPdfNota`, `montarNfeProc`) — confirme com:
```bash
grep -n "gerarPdfNota\|montarNfeProc" app/api/fiscal/emitir/route.ts
```
Se não sobrar nenhum outro uso, apague as duas entradas do import de `@/lib/fiscal/pdf` no topo do arquivo.

- [ ] **Step 4: `npx tsc --noEmit`**

Esperado: limpo.

- [ ] **Step 5: Regressão — emitir uma nota de teste em homologação de ponta a ponta**

Confirme antes que a loja de teste usada tem `ambiente: 'homologacao'`:
```bash
node --env-file=.env.local -e "
const {createClient} = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
sb.from('store_fiscal_config').select('store_id,ambiente').then(r => console.log(r.data));
"
```
Feche uma venda de teste (com nota fiscal habilitada) numa loja com `ambiente: 'homologacao'` e confirme que a nota sai `autorizada` com PDF, exatamente como antes da Task 3 — este passo prova que o refactor não mudou o comportamento síncrono.

- [ ] **Step 6: Commit**

```bash
git add lib/fiscal/salvarNotaAutorizada.ts app/api/fiscal/emitir/route.ts
git commit -m "refactor(fiscal): extrai salvarNotaAutorizada (compartilhado c/ retransmissao futura)"
```

---

### Task 4: PDF de contingência

**Files:**
- Create: `lib/fiscal/pdfContingencia.ts`

**Interfaces:**
- Consumes: nenhuma dependência de tasks anteriores além de tipos já existentes (`ItemNota`, `PagamentoNota` de `lib/fiscal/xml.ts`).
- Produces:
```typescript
export interface DadosPdfContingencia {
  storeName: string;
  cnpj: string;
  endereco?: string;
  chave: string; // 44 dígitos
  dataHora: Date;
  itens: { descricao: string; quantidade: number; valorUnitario: number; valorTotal: number }[];
  valorTotal: number;
  via: 1 | 2; // rodapé "1ª via - Cliente" / "2ª via - Estabelecimento"
}

export async function gerarPdfContingencia(dados: DadosPdfContingencia): Promise<Buffer>;
```
Consumido pela Task 5 (rota de emissão) e reaproveitado pela Task 6 (impressão em 2 vias — chamado 1x com `via: 1`, 1x com `via: 2`).

- [ ] **Step 1: Confirmar que `pdfkit` está disponível como dependência**

```bash
grep -n '"pdfkit"' package.json node_modules/nfe-danfe-pdf/package.json 2>/dev/null
node -e "require('pdfkit'); console.log('ok')"
```
Esperado: `ok` — `pdfkit` já vem transitivamente via `nfe-danfe-pdf`. Se o `require` falhar, rode `npm install pdfkit --save` antes de continuar (viraria uma dependência direta do projeto).

- [ ] **Step 2: Escrever `lib/fiscal/pdfContingencia.ts`**

```typescript
import PDFDocument from 'pdfkit';

export interface DadosPdfContingencia {
  storeName: string;
  cnpj: string;
  endereco?: string;
  chave: string;
  dataHora: Date;
  itens: { descricao: string; quantidade: number; valorUnitario: number; valorTotal: number }[];
  valorTotal: number;
  via: 1 | 2;
}

const LARGURA_MM = 80;
const MM_PARA_PT = 2.834645669;
const LARGURA_PT = LARGURA_MM * MM_PARA_PT;

function formatarChave(chave: string): string {
  return chave.replace(/(\d{4})(?=\d)/g, '$1 ');
}

function formatarBRL(valor: number): string {
  return valor.toFixed(2).replace('.', ',');
}

// Cupom de contingência (NFC-e emitida com tpEmis=9, SEM protocolo da
// SEFAZ ainda) — layout próprio porque `nfe-danfe-pdf` (usado pro cupom
// normal, ver lib/fiscal/pdf.ts) exige protNFe.infProt e quebra sem ele.
// Aviso legal obrigatório em destaque, sem QR Code de autorização (o hash
// do QR depende do CSC + protocolo, que não existem neste momento) — só
// texto com a chave de acesso pra consulta manual depois.
export function gerarPdfContingencia(dados: DadosPdfContingencia): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [LARGURA_PT, 1000], margins: { top: 10, bottom: 10, left: 8, right: 8 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const largura = LARGURA_PT - 16;

    doc.font('Helvetica-Bold').fontSize(9).text(dados.storeName.toUpperCase(), { width: largura, align: 'center' });
    doc.font('Helvetica').fontSize(7).text(`CNPJ: ${dados.cnpj}`, { width: largura, align: 'center' });
    if (dados.endereco) doc.text(dados.endereco, { width: largura, align: 'center' });
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').fontSize(8).fillColor('black').text(
      'EMITIDO EM CONTINGENCIA - DOCUMENTO SEM VALIDACAO DA SEFAZ NO MOMENTO DA EMISSAO',
      { width: largura, align: 'center' },
    );
    doc.font('Helvetica').fontSize(7).text(
      dados.dataHora.toLocaleString('pt-BR'),
      { width: largura, align: 'center' },
    );
    doc.moveDown(0.3);
    doc.text('-'.repeat(42), { width: largura });

    doc.font('Helvetica').fontSize(7);
    for (const item of dados.itens) {
      doc.text(
        `${item.quantidade}x ${item.descricao} - R$ ${formatarBRL(item.valorTotal)}`,
        { width: largura },
      );
    }
    doc.text('-'.repeat(42), { width: largura });
    doc.font('Helvetica-Bold').text(`TOTAL: R$ ${formatarBRL(dados.valorTotal)}`, { width: largura });
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(7).text('Chave de acesso:', { width: largura });
    doc.text(formatarChave(dados.chave), { width: largura });
    doc.moveDown(0.3);
    doc.text(
      'Consulte a autorizacao desta nota, quando disponivel, pela chave de acesso no site da SEFAZ do seu estado.',
      { width: largura },
    );

    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(8).text(
      dados.via === 1 ? '1a VIA - CLIENTE' : '2a VIA - ESTABELECIMENTO',
      { width: largura, align: 'center' },
    );

    doc.end();
  });
}
```

- [ ] **Step 3: Testar isoladamente (script descartável, sem tocar produção)**

```bash
node --env-file=.env.local -e "
const { gerarPdfContingencia } = require('./lib/fiscal/pdfContingencia.ts');
" 2>&1 | head -5
```
(Este teste direto via `node -e` não vai funcionar contra um arquivo `.ts` sem transpilar — em vez disso, escreva um script `.mjs` temporário fora do repo que importe via `tsx`/`ts-node` se disponível, OU pule pra Step 4 e teste via `tsc --noEmit` + o teste de integração real da Task 5, que é o que efetivamente valida esta função.)

- [ ] **Step 4: `npx tsc --noEmit`**

Esperado: limpo. Se `pdfkit` não tiver types (`@types/pdfkit`), adicione:
```bash
npm install --save-dev @types/pdfkit
```

- [ ] **Step 5: Commit**

```bash
git add lib/fiscal/pdfContingencia.ts package.json package-lock.json
git commit -m "feat(fiscal): PDF de cupom de contingencia (sem protocolo)"
```

---

### Task 5: Detectar falha de transporte e emitir em contingência

**Files:**
- Modify: `app/api/fiscal/emitir/route.ts` (Fase 1 — bloco `catch` e a decisão pré-transmissão)

**Interfaces:**
- Consumes: `montarXmlNota({ ..., tpEmis: 9 })` (Task 2), `gerarPdfContingencia` (Task 4), `assinarXmlNota` (já existe, sem mudança).
- Produces: nenhuma nova interface pública — o resultado é uma linha `fiscal_notas` com `status: 'contingencia'` e `pdf_path` preenchido, que já é o formato que `aguardarNotaFiscalDaVenda` (Task 6) sabe ler.

- [ ] **Step 1: Ler o bloco atual de Fase 1 (montagem, assinatura, QR, transmissão, catch)**

```bash
grep -n "FASE 1\|catch (e)\|transmitirNota(" app/api/fiscal/emitir/route.ts | head -20
```

- [ ] **Step 2: Envolver a chamada a `transmitirNota` numa classificação de erro**

Localize o `try { ... resposta = await transmitirNota({...}); } catch (e) { ... }` da Fase 1 (o bloco que hoje grava `status: 'erro'` em qualquer exceção). Substitua o `catch` por:

```typescript
  } catch (e) {
    // Falha de TRANSPORTE (rede/DNS/TLS/timeout — a exceção vem de
    // dentro de transmitirNota, ver lib/fiscal/soap.ts) — candidata a
    // contingência. Qualquer outra exceção nesta fase (certificado não
    // decripta, erro ao montar XML) continua caindo em 'erro' — nunca
    // vira contingência às cegas.
    const mensagemErro = e instanceof Error ? e.message : 'Erro desconhecido';
    const ehFalhaDeTransporte =
      mensagemErro.includes('Timeout na transmissão pra SEFAZ') ||
      (e as { code?: string })?.code === 'ECONNREFUSED' ||
      (e as { code?: string })?.code === 'ENOTFOUND' ||
      (e as { code?: string })?.code === 'ETIMEDOUT';

    if (ehFalhaDeTransporte) {
      return await emitirEmContingencia({
        admin, storeId, modelo, ambiente: config.ambiente, serie, numero,
        itensValidos, notaBase, valorTotalComTaxa, certComCadeia, keyPem,
        emitente: dadosEmitente,
      });
    }

    const { error: insertErr } = await admin.from('fiscal_notas').insert({
      ...notaBase,
      valor_total: valorTotalComTaxa,
      status: 'erro',
      motivo_erro: mensagemErro,
    });
    if (insertErr) console.error('Emissão fiscal: falha ao gravar fiscal_notas (erro pré-autorização):', insertErr);
    console.error('Emissão fiscal falhou (fase pré-autorização):', e);
    return NextResponse.json({ ok: false, reason: mensagemErro });
  }
```

Ajuste os nomes das variáveis capturadas (`config`, `dadosEmitente`, `certComCadeia`, `keyPem`, etc.) pros nomes REAIS já usados no escopo da função — confirme com:
```bash
grep -n "const config\|const dadosEmitente\|certComCadeia\|keyPem =" app/api/fiscal/emitir/route.ts
```
antes de fechar este passo, e ajuste a chamada pra bater exatamente.

Também é preciso tratar o caso em que a resposta CHEGA mas `cStat` vem `null` (gateway/erro de transporte disfarçado de resposta HTTP) — logo depois de `resposta = await transmitirNota(...)`, antes da checagem de `resposta.cStat !== '100'` já existente, adicione:

```typescript
  if (resposta.cStat === null) {
    return await emitirEmContingencia({
      admin, storeId, modelo, ambiente: config.ambiente, serie, numero,
      itensValidos, notaBase, valorTotalComTaxa, certComCadeia, keyPem,
      emitente: dadosEmitente,
    });
  }
```

- [ ] **Step 3: Escrever `emitirEmContingencia` (função local, mesmo arquivo)**

Adicione esta função no mesmo arquivo, antes de `emitirNotaFiscal`:

```typescript
async function emitirEmContingencia(params: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  storeId: string;
  modelo: '55' | '65';
  ambiente: 'homologacao' | 'producao';
  serie: number;
  numero: number;
  itensValidos: { id: string; nome: string; quantidade: number; valorUnitario: number }[];
  notaBase: Record<string, unknown>;
  valorTotalComTaxa: number;
  certComCadeia: string;
  keyPem: string;
  emitente: Parameters<typeof montarXmlNota>[0]['emitente'];
}): Promise<NextResponse> {
  const { admin, storeId, modelo, ambiente, serie, numero, itensValidos, notaBase, valorTotalComTaxa, certComCadeia, keyPem, emitente } = params;

  try {
    const { xml, chave } = montarXmlNota({
      modelo,
      ambiente,
      serie,
      numero,
      emitente,
      itens: itensValidos.map((i) => ({ nome: i.nome, quantidade: i.quantidade, valorUnitario: i.valorUnitario })),
      tpEmis: 9,
    });
    const xmlAssinado = assinarXmlNota(xml, certComCadeia, keyPem);

    const dataHora = new Date();
    const pdfVia1 = await gerarPdfContingencia({
      storeName: String(notaBase.store_name ?? ''),
      cnpj: emitente.cnpj,
      chave,
      dataHora,
      itens: itensValidos.map((i) => ({
        descricao: i.nome,
        quantidade: i.quantidade,
        valorUnitario: i.valorUnitario,
        valorTotal: i.quantidade * i.valorUnitario,
      })),
      valorTotal: valorTotalComTaxa,
      via: 1,
    });

    const caminhoPdf = `${storeId}/${chave}-contingencia.pdf`;
    const upload = await admin.storage.from('fiscal-documentos').upload(caminhoPdf, pdfVia1, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (upload.error) throw upload.error;

    const { error: insertErr } = await admin.from('fiscal_notas').insert({
      ...notaBase,
      valor_total: valorTotalComTaxa,
      status: 'contingencia',
      chave_acesso: chave,
      numero,
      serie,
      xml_contingencia: xmlAssinado,
      pdf_path: caminhoPdf,
    });
    if (insertErr) {
      console.error('emitirEmContingencia: falha ao gravar fiscal_notas:', insertErr);
      return NextResponse.json({ ok: false, reason: 'Falha ao gravar nota em contingência' });
    }

    return NextResponse.json({ ok: true, contingencia: true });
  } catch (e) {
    const mensagemErro = e instanceof Error ? e.message : 'Erro desconhecido';
    console.error('emitirEmContingencia falhou:', e);
    const { error: insertErr } = await admin.from('fiscal_notas').insert({
      ...notaBase,
      valor_total: valorTotalComTaxa,
      status: 'erro',
      motivo_erro: `Falha ao emitir em contingência: ${mensagemErro}`,
    });
    if (insertErr) console.error('emitirEmContingencia: falha ao gravar erro:', insertErr);
    return NextResponse.json({ ok: false, reason: mensagemErro });
  }
}
```

**Nota pro implementador:** os nomes exatos de `notaBase.store_name` e o formato de `itensValidos` (campos `nome`/`quantidade`/`valorUnitario`) precisam bater com o que a Fase 1 já monta hoje — leia como `notaBase` e `itensValidos` são construídos mais acima no arquivo (`grep -n "const itensValidos\|const notaBase" app/api/fiscal/emitir/route.ts`) e ajuste os nomes de campo neste snippet pra bater exatamente, incluindo o nome da loja (pode já não estar em `notaBase` — se não estiver, busque via `admin.from('stores').select('name').eq('id', storeId).single()` antes de montar `pdfVia1`).

Adicione os imports novos no topo do arquivo:
```typescript
import { montarXmlNota } from '@/lib/fiscal/xml';
import { assinarXmlNota } from '@/lib/fiscal/assinatura';
import { gerarPdfContingencia } from '@/lib/fiscal/pdfContingencia';
```
(remova duplicatas se `montarXmlNota`/`assinarXmlNota` já estiverem importados por outro caminho no arquivo.)

- [ ] **Step 4: `npx tsc --noEmit`**

Esperado: limpo.

- [ ] **Step 5: Testar em homologação — simular falha de rede**

Em `.env.local` (loja de teste, `ambiente: 'homologacao'`), aponte temporariamente `resolverEndpoint` (ou o host usado por `transmitirNota`) pra um endereço inexistente — **não editar o arquivo de produção pra isso**, em vez disso: derrube a rota da SEFAZ artificialmente rodando o teste sem VPN/com um firewall local bloqueando o host de homologação por 1 minuto, OU (mais simples e sem mexer em infraestrutura) rode um teste unitário chamando `emitirEmContingencia` diretamente com dados fake, sem passar por `transmitirNota`:

```bash
node --env-file=.env.local -e "
const { gerarPdfContingencia } = require('./lib/fiscal/pdfContingencia');
gerarPdfContingencia({
  storeName: 'Loja Teste', cnpj: '00000000000000', chave: '2'.repeat(44),
  dataHora: new Date(), itens: [{descricao:'Item teste', quantidade:1, valorUnitario:10, valorTotal:10}],
  valorTotal: 10, via: 1,
}).then(buf => { require('fs').writeFileSync('/tmp/teste-contingencia.pdf', buf); console.log('PDF gerado, ' + buf.length + ' bytes'); });
"
```
Abra `/tmp/teste-contingencia.pdf` e confirme visualmente: aviso de contingência em destaque, chave de acesso, itens, total, "1a VIA - CLIENTE" no rodapé — sem número de protocolo em lugar nenhum.

- [ ] **Step 6: Commit**

```bash
git add app/api/fiscal/emitir/route.ts
git commit -m "feat(fiscal): emite em contingencia (tpEmis=9) quando SEFAZ/rede falha"
```

---

### Task 6: Client — aceitar status `contingencia` e imprimir 2 vias

**Files:**
- Modify: `lib/api.ts` (`aguardarNotaFiscalDaVenda`)
- Modify: `components/modules/StoreModule.tsx` (`abrirCupomFiscalQuandoSair`)

**Interfaces:**
- Consumes: `FiscalNota.status` agora pode ser `'contingencia'` (tipo já é `string`-based em `types/index.ts`? confirme — se for um union literal, adicione `'contingencia'` lá também).

- [ ] **Step 1: Adicionar `'contingencia'` ao tipo `FiscalNota.status`, se for union literal**

```bash
grep -n "status:" types/index.ts | grep -i fiscal
```
Se a linha for algo como `status: 'pendente' | 'autorizada' | 'rejeitada' | 'erro';`, adicione `| 'contingencia'`.

- [ ] **Step 2: `aguardarNotaFiscalDaVenda` aceita `contingencia` como resultado válido**

Em `lib/api.ts`, ache:
```typescript
      if (daVenda?.status === 'autorizada' && daVenda.pdf_path) {
```
Troque por:
```typescript
      if ((daVenda?.status === 'autorizada' || daVenda?.status === 'contingencia') && daVenda.pdf_path) {
```
(o resto do bloco — `fetchFiscalNotaPdfUrl` + `return { pdfUrl, nota }` — não muda; `contingencia` já tem `pdf_path` preenchido desde a Task 5.)

- [ ] **Step 3: Imprimir 2 vias quando `nota.status === 'contingencia'`**

Em `components/modules/StoreModule.tsx`, dentro de `abrirCupomFiscalQuandoSair`, no branch Electron (`if (isElectron) { aguardarNotaFiscalDaVenda(...).then((resultado) => { if (resultado) { ... window.open(resultado.pdfUrl, '_blank'); } ... }) }`), troque o `window.open` único por:

```typescript
                if (resultado) {
                    window.open(resultado.pdfUrl, '_blank');
                    // Contingência: 2 vias físicas (cliente + estabelecimento) —
                    // pedido explícito do dono (2026-09-15), já que o
                    // documento não tem protocolo ainda e o cliente precisa
                    // sair com o comprovante em papel mesmo assim.
                    if (resultado.nota.status === 'contingencia') {
                        window.open(resultado.pdfUrl, '_blank');
                        toast('Nota emitida em contingência — 2 vias impressas. Será enviada à SEFAZ automaticamente quando a conexão voltar.', { icon: '⚠️' });
                    }
                } else {
```

Aplique a mesma mudança no branch não-Electron (o outro `.then((resultado) => { ... janela.location.href = resultado.pdfUrl; ... })`), adicionando depois de setar `janela.location.href`:

```typescript
                if (resultado.nota.status === 'contingencia') {
                    window.open(resultado.pdfUrl, '_blank');
                    toast('Nota emitida em contingência — 2 vias impressas.', { icon: '⚠️' });
                }
```

Confirme a assinatura exata da função `toast` usada neste arquivo (`grep -n "^import.*toast" components/modules/StoreModule.tsx`) — se for `react-hot-toast` puro, `toast(msg, {icon})` funciona; se for um wrapper próprio do projeto sem suporte a `icon`, use só `toast(msg)`.

- [ ] **Step 4: `npx tsc --noEmit`**

- [ ] **Step 5: Commit**

```bash
git add lib/api.ts components/modules/StoreModule.tsx types/index.ts
git commit -m "feat(fiscal): client aceita status contingencia, imprime 2 vias"
```

---

### Task 7: Retransmissão automática em background

**Files:**
- Create: `lib/fiscal/retransmissao.ts`
- Create: `instrumentation.ts` (raiz do projeto, ao lado de `next.config.ts`)

**Interfaces:**
- Consumes: `salvarNotaAutorizada` (Task 3), `transmitirNota` (já existe).
- Produces: `verificarNotasEmContingencia(): Promise<void>` — chamada pelo `setInterval` de `instrumentation.ts`, também exportada pra poder ser testada isoladamente via script.

- [ ] **Step 1: Confirmar suporte a `instrumentation.ts` nesta versão do Next**

```bash
grep -n '"next"' package.json
```
Next.js 15+ já trata `instrumentation.ts` como hook estável (roda uma vez quando o processo sobe, antes de qualquer request) — sem flag experimental necessária. Se o `next.config.ts` tiver `experimental: { instrumentationHook: false }` explícito, remova essa linha.

- [ ] **Step 2: Escrever `lib/fiscal/retransmissao.ts`**

```typescript
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getCertificadoParaLoja } from '@/lib/fiscal/certificado'; // confirme o nome exato exportado — ver Step 3
import { transmitirNota } from '@/lib/fiscal/soap';
import { salvarNotaAutorizada } from '@/lib/fiscal/salvarNotaAutorizada';

// Roda a cada 2 minutos (ver instrumentation.ts). Reprocessa TODAS as
// notas 'contingencia' de TODAS as lojas — reenviar o mesmo XML já
// assinado várias vezes é seguro (a SEFAZ responde com o protocolo já
// emitido se a chave já foi processada antes), então não há risco de
// duplicar em caso de dois ciclos rodando perto um do outro.
export async function verificarNotasEmContingencia(): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: pendentes, error } = await admin
    .from('fiscal_notas')
    .select('id, store_id, modelo, chave_acesso, numero, serie, xml_contingencia, order_id, table_id')
    .eq('status', 'contingencia');

  if (error) {
    console.error('verificarNotasEmContingencia: falha ao buscar pendentes:', error);
    return;
  }
  if (!pendentes || pendentes.length === 0) return;

  for (const nota of pendentes) {
    if (!nota.xml_contingencia) continue;
    try {
      const { certPem, keyPem } = await carregarCertificadoDaLoja(admin, nota.store_id);
      const config = await carregarConfigFiscalDaLoja(admin, nota.store_id);

      const resposta = await transmitirNota({
        modelo: nota.modelo,
        ambiente: config.ambiente,
        xmlAssinadoComSupl: nota.xml_contingencia,
        certPem,
        keyPem,
      });

      if (resposta.cStat === '100') {
        const { data: itens } = await admin.from('order_items').select('id').eq('fiscal_nota_id', nota.id);
        await salvarNotaAutorizada({
          storeId: nota.store_id,
          modelo: nota.modelo,
          chave: nota.chave_acesso!,
          numero: nota.numero!,
          serie: nota.serie!,
          xmlAssinado: nota.xml_contingencia,
          protocoloXmlBruto: resposta.xmlBruto,
          protocolo: resposta.protocolo!,
          valorTotalComTaxa: 0, // já gravado na tentativa original; não recalcula aqui — ver Step 3 abaixo
          notaBase: { store_id: nota.store_id, order_id: nota.order_id, table_id: nota.table_id, modelo: nota.modelo, ambiente: config.ambiente },
          itensValidos: itens ?? [],
          notaIdExistente: nota.id,
        });
      } else if (resposta.cStat !== null) {
        // Rejeição de negócio de verdade — o documento não vai ser
        // aceito nunca, mesmo reenviando de novo. Marca como rejeitada
        // pra sair da fila de retry e aparecer pro lojista agir.
        await admin.from('fiscal_notas').update({
          status: 'rejeitada',
          motivo_erro: `cStat=${resposta.cStat} ${resposta.xMotivo ?? ''}`.trim(),
        }).eq('id', nota.id);
      }
      // cStat === null (ainda sem rede): não faz nada, tenta de novo no próximo ciclo.
    } catch (e) {
      console.error(`verificarNotasEmContingencia: falha ao retransmitir nota ${nota.id}:`, e);
      // Continua sem rede — próximo ciclo tenta de novo.
    }
  }
}
```

**Nota pro implementador — dois pontos que exigem confirmar código real antes de fechar este arquivo:**

1. `valor_total: 0` no `salvarNotaAutorizada` acima é um placeholder inaceitável (viola a regra "No Placeholders" deste plano) — antes de implementar, leia `salvarNotaAutorizada` (Task 3): `valorTotalComTaxa` só é usado pro campo `fiscal_notas.valor_total`. Como a linha `contingencia` JÁ tem esse valor gravado (inserido na Task 5), troque a estratégia: no `update()` de `salvarNotaAutorizada`, quando `notaIdExistente` está presente, **não** sobrescreva `valor_total` — troque `salvarNotaAutorizada` (Task 3) pra montar `linha` condicionalmente, omitindo `valor_total` do objeto quando `notaIdExistente` estiver presente. Ajuste a Task 3 e esta task juntas nesse detalhe antes de rodar `tsc`.
2. `getCertificadoParaLoja`/`carregarCertificadoDaLoja`/`carregarConfigFiscalDaLoja` são nomes de exemplo — leia `app/api/fiscal/emitir/route.ts` do começo (`sed -n '1,95p'`) pra ver EXATAMENTE como a Fase 1 de hoje carrega certificado (`extrairCertificado` + resolução de cadeia) e config fiscal (`store_fiscal_config`) da loja, e reaproveite esse código exato aqui — não invente nomes novos, extraia (ou reaproveite) as funções que já existem, criando um helper novo só se a lógica de carregar certificado/config não estiver isolada em nenhuma função reutilizável hoje (rota inteira faz isso inline). Se for inline na rota, extraia pra `lib/fiscal/carregarCredenciaisLoja.ts` com uma função `carregarCredenciaisFiscaisDaLoja(storeId): Promise<{certPem, keyPem, config}>`, usada pelos DOIS lugares (rota de emissão E este módulo de retransmissão) — mesmo princípio de DRY da Task 3.

- [ ] **Step 3: Resolver o placeholder de `valor_total` (ver nota acima) — ajustar `salvarNotaAutorizada`**

Em `lib/fiscal/salvarNotaAutorizada.ts` (Task 3), troque a montagem de `linha`:

```typescript
  const linha: Record<string, unknown> = {
    ...dados.notaBase,
    status: 'autorizada' as const,
    chave_acesso: dados.chave,
    numero: dados.numero,
    serie: dados.serie,
    protocolo: dados.protocolo,
    xml_path: xmlPath,
    pdf_path: pdfPath,
    motivo_erro: motivoPosAutorizacao,
  };
  // Na emissão síncrona (INSERT) valor_total precisa ser gravado; na
  // retransmissão de uma nota que nasceu 'contingencia' (UPDATE), o valor
  // já foi gravado na tentativa original — omitir aqui evita depender de
  // recalcular o mesmo valor duas vezes em dois lugares do código.
  if (!dados.notaIdExistente) {
    linha.valor_total = dados.valorTotalComTaxa;
  }
```

Isso torna `valorTotalComTaxa` opcional na prática pro caminho de retransmissão — ajuste a interface `DadosNotaAutorizada` pra `valorTotalComTaxa: number` continuar obrigatória no tipo (simplicidade: quem chama do retransmissao.ts só passa `0` sabendo que é ignorado — documente isso com um comentário no call site em `retransmissao.ts`, trocando o comentário `// já gravado...` por algo explícito: `valorTotalComTaxa: 0, // ignorado no UPDATE — ver salvarNotaAutorizada`).

- [ ] **Step 4: Escrever `instrumentation.ts`**

```typescript
// Hook oficial do Next.js 15+ — roda UMA VEZ quando o processo do
// servidor sobe (nunca em cada request, nunca no build). É aqui que
// vive o job de retransmissão de notas fiscais em contingência: o app
// roda como processo systemd contínuo no Contabo (não é serverless),
// então um setInterval de longa duração dentro do próprio processo é
// suficiente — não precisa de cron externo nem fila.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { verificarNotasEmContingencia } = await import('./lib/fiscal/retransmissao');
  const DOIS_MINUTOS = 2 * 60 * 1000;
  setInterval(() => {
    verificarNotasEmContingencia().catch((e) => console.error('Erro no ciclo de retransmissão fiscal:', e));
  }, DOIS_MINUTOS);
}
```

- [ ] **Step 5: `npx tsc --noEmit`**

- [ ] **Step 6: Testar isoladamente via script**

```bash
node --env-file=.env.local -e "
require('ts-node/register');
const { verificarNotasEmContingencia } = require('./lib/fiscal/retransmissao.ts');
verificarNotasEmContingencia().then(() => console.log('ciclo rodou sem lançar exceção'));
" 2>&1 | tail -20
```
Se `ts-node` não estiver instalado, adapte pra compilar com `npx tsc lib/fiscal/retransmissao.ts --outDir /tmp/build ...` ou teste via uma rota de debug temporária chamada manualmente — o objetivo é confirmar que a função roda sem lançar quando não há nenhuma nota `contingencia` pendente (comportamento mais comum).

- [ ] **Step 7: Teste de ponta a ponta em homologação**

Depois do deploy (Step 8), force uma nota real em `contingencia` (via Task 5, simulando falha de rede numa loja de teste) e confirme que, em até ~2 minutos após a rede ser restaurada, a linha vira `autorizada` sozinha (consulta direta: `select status, protocolo from fiscal_notas where id = '<id>'`).

- [ ] **Step 8: Commit e deploy**

```bash
git add lib/fiscal/retransmissao.ts instrumentation.ts lib/fiscal/salvarNotaAutorizada.ts lib/fiscal/carregarCredenciaisLoja.ts
git commit -m "feat(fiscal): retransmissao automatica em background pra notas em contingencia"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```
Confirme no log do systemd que o processo sobe sem erro relacionado a `instrumentation.ts`:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "journalctl -u ntb-vendas -n 30 --no-pager"
```

---

### Task 8: Alerta de contingência pendente no painel

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`FISCAL_STATUS_LABELS`, `fiscalStatusBadgeColor`, `FiscalNotasView`)

**Interfaces:**
- Consumes: `notas` (state já carregado por `FiscalNotasView` via `fetchFiscalNotas`, sem mudança de fetch).

- [ ] **Step 1: Rótulo e cor do badge pro status novo**

```bash
grep -n "FISCAL_STATUS_LABELS\|fiscalStatusBadgeColor" components/modules/StoreModule.tsx
```
Em `FISCAL_STATUS_LABELS` (linha ~9596), adicione:
```typescript
    contingencia: 'Contingência',
```
Em `fiscalStatusBadgeColor`, adicione um `case` antes do `default`:
```typescript
        case 'contingencia': return 'bg-amber-500/10 text-amber-600 border border-amber-500/20';
```

- [ ] **Step 2: Banner de alerta em `FiscalNotasView`**

Logo depois de `return (` e da abertura de `<div className="space-y-6">` (linha ~9803, ANTES do `<Card>` da lista), adicione:

```tsx
            {(() => {
                const emContingencia = notas.filter((n) => n.status === 'contingencia');
                if (emContingencia.length === 0) return null;
                const UMA_HORA_MS = 60 * 60 * 1000;
                const antigas = emContingencia.filter((n) => Date.now() - new Date(n.created_at).getTime() > 2 * UMA_HORA_MS);
                return (
                    <div className={`p-3 rounded-lg border text-sm font-medium ${antigas.length > 0 ? 'bg-[var(--err)]/10 border-[var(--err)]/30 text-[var(--err)]' : 'bg-amber-500/10 border-amber-500/30 text-amber-700'}`}>
                        {antigas.length > 0
                            ? `${antigas.length} nota(s) em contingência pendente(s) há mais de 2h — verifique a conexão com a SEFAZ. (${emContingencia.length} no total aguardando confirmação.)`
                            : `${emContingencia.length} nota(s) em contingência aguardando confirmação automática da SEFAZ.`}
                    </div>
                );
            })()}
```

- [ ] **Step 3: `npx tsc --noEmit`**

- [ ] **Step 4: Teste visual**

Rode `npm run dev`, force (via SQL direto, loja de teste) uma linha `fiscal_notas` com `status: 'contingencia'` e `created_at` de 3 horas atrás, abra Administração → Notas Fiscais e confirme que o banner vermelho aparece com a contagem certa. Apague a linha de teste depois.

- [ ] **Step 5: Commit e deploy**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat(fiscal): alerta de contingencia pendente no painel"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

---

## Self-Review (rodado ao escrever este plano)

- **Cobertura da spec:** detecção automática (Task 5) ✅, cupom 2 vias (Task 6) ✅, retransmissão automática em background (Task 7) ✅, alerta no painel pra pendência antiga (Task 8) ✅, migration do status/coluna nova (Task 1) ✅.
- **Placeholder achado e resolvido durante a escrita:** `valorTotalComTaxa: 0` no primeiro rascunho da Task 7 — resolvido explicitamente na própria Task 7 (Step 3) trocando `salvarNotaAutorizada` pra omitir `valor_total` no caminho de UPDATE, em vez de aceitar um valor fictício.
- **Consistência de tipos:** `salvarNotaAutorizada`/`DadosNotaAutorizada` (Task 3) é o mesmo tipo usado por `retransmissao.ts` (Task 7) e por `app/api/fiscal/emitir/route.ts` (Task 3) — `notaIdExistente` é o único campo que distingue INSERT de UPDATE nos dois consumidores.
- **Risco de nomes incertos, sinalizado explicitamente pro implementador (não escondido):** Task 5 (nomes de variáveis locais da rota) e Task 7 (nome real da função de carregar certificado/config fiscal, e se precisa ser extraída) dependem de ler o código real no momento da implementação — o plano instrui explicitamente a confirmar via `grep`/leitura antes de cada um desses pontos, em vez de assumir um nome que pode estar errado.
