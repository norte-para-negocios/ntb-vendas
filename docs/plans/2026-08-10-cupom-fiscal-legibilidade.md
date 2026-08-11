# Cupom Fiscal Mais Legível — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** O documento fiscal (XML/NFC-e) já é válido e autorizado pela SEFAZ, mas o cupom impresso (PDF/DANFCe) tem 4 problemas de legibilidade/dado incompleto: código de produto ilegível, telefone ausente, tributos sempre zerados, e protocolo/URL de consulta errados. Corrigir os dois primeiros (rápidos, sem dependência externa) e escopar os outros dois (dependem de biblioteca externa e cadastro externo).

**Architecture:** Mudanças pontuais em `lib/fiscal/xml.ts` (monta o XML) e `app/api/fiscal/emitir/route.ts` (orquestra a emissão), mais uma migration nova pra guardar telefone da loja, mais possível troca da lib de geração de PDF (`node-sped-pdf` → `nfe-danfe-pdf` ou `@nfewizard/danfe`) só pra função de DANFCe.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres), XML manual (sem lib de template), `node-sped-pdf` (a trocar no Task 4).

**Contexto real já confirmado nesta sessão (não repetir a investigação):**
- `cProd` do XML usa `String(product.id).slice(0,8)` (UUID truncado) em vez do `omie_codigo` real — `lib/fiscal/xml.ts:4` já documenta no comentário que `cProd` "pode ser o id truncado ou omie_codigo", ou seja, o tipo já foi pensado pra aceitar o código real, só nunca foi passado.
- `stores` e `store_fiscal_config` não têm NENHUMA coluna de telefone hoje (confirmado lendo as migrations 001 e 024/025).
- A string `Tributos Totais incidentes (Lei Federal 12.741/2012) - Total R$ 0,00 0,00% - Federal 0,00% - Estadual 0,00% - Municipal 0,00%` está **hardcoded** dentro de `node_modules/node-sped-pdf/dist/index.js` (não lê `vTotTrib` do XML — o pacote nem procura essa tag). Confirmado lendo o bundle compilado.
- A linha `Protocolo de Autorização 000000000000000` também é **hardcoded** no mesmo pacote (`infNFe.procEmi === "0" ? "Protocolo não informado" : "Protocolo de Autorização 000000000000000"` — nenhum dos dois ramos usa o protocolo real do XML). A URL `sefaz.mt.gov.br/nfce/consulta` no rodapé também está fixa no template, ignora a UF real.
- Alternativas de biblioteca encontradas via pesquisa (não testadas ainda): `nfe-danfe-pdf` (github.com/flaviosoliver/nfe-danfe-pdf), `@nfewizard/danfe` (npm).
- Cálculo real de tributos (Lei 12.741/2012) exige tabela do IBPT via cadastro gratuito em `deolhonoimposto.ibpt.org.br` — tabela por NCM, atualizada trimestralmente. Não há API gratuita pronta encontrada; o caminho é baixar a tabela (planilha/CSV) e fazer lookup local por NCM.

---

### Task 1: `cProd` real (código Omie) no cupom

**Files:**
- Modify: `app/api/fiscal/emitir/route.ts:211-214` (select) e `:380-386` (montagem de `itensXml`)

**Step 1: Ampliar o select pra trazer `omie_codigo`**

Em `app/api/fiscal/emitir/route.ts`, linha ~213:

```ts
  const { data: items } = await admin
    .from('order_items')
    .select('quantity, status, price_at_time, product:products(id, name, ncm, omie_codigo)')
    .in('order_id', orderIds);
```

**Step 2: Usar `omie_codigo` com fallback pro UUID truncado**

Linha ~380-386, trocar:

```ts
    const itensXml: ItemNota[] = itensValidos.map((i) => ({
      cProd: String((i as any).product.id).slice(0, 8),
      xProd: (i as any).product.name,
      ncm: (i as any).product.ncm,
      qCom: i.quantity,
      vUnCom: Number(i.price_at_time),
    }));
```

por:

```ts
    const itensXml: ItemNota[] = itensValidos.map((i) => ({
      // omie_codigo é o SKU real (ex.: "90935"), legível no cupom impresso.
      // Fallback pro UUID truncado só cobre produtos cadastrados manualmente
      // sem vínculo com o Omie (omie_codigo null) — nunca deve faltar código.
      cProd: (i as any).product.omie_codigo || String((i as any).product.id).slice(0, 8),
      xProd: (i as any).product.name,
      ncm: (i as any).product.ncm,
      qCom: i.quantity,
      vUnCom: Number(i.price_at_time),
    }));
```

**Step 3: Verificar manualmente (sem suite de testes automatizados neste projeto)**

Fechar um pedido de teste na loja "O Sertão Vai Virar Mar" (ambiente homologação) com um produto que tenha `omie_codigo` preenchido (todos os 684 produtos importados têm), baixar o cupom em Administração → Notas Fiscais, e confirmar visualmente que a coluna CODIGO mostra o código Omie (ex. `90935`), não um pedaço de UUID.

**Step 4: Deploy**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
git add app/api/fiscal/emitir/route.ts
git commit -m "fix(fiscal): usa omie_codigo real como cProd no cupom, não UUID truncado"
git push
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-vendas && git pull --ff-only && npm ci && npm run build && systemctl restart ntb-vendas"
```

---

### Task 2: Telefone da loja no cupom

**Files:**
- Create: `supabase/migrations/041_telefone_emissor.sql`
- Modify: `app/api/certificado/route.ts` (aceitar e gravar `telefone`)
- Modify: `lib/api.ts` (tipo de `store_fiscal_config`, função de save)
- Modify: `components/modules/AdminModule.tsx` (campo novo em "Editar Loja")
- Modify: `components/modules/StoreModule.tsx` (campo novo em "Certificado e Configuração Fiscal")
- Modify: `lib/fiscal/xml.ts` (`DadosEmitenteNota` + `<fone>` no XML)
- Modify: `app/api/fiscal/emitir/route.ts` (passar `config.telefone` pro `emitente`)

**Step 1: Migration**

```sql
-- Telefone do emissor pro cupom fiscal (Fone: N/D hoje, campo nunca existiu
-- em nenhuma tabela — nem stores nem store_fiscal_config). Mesmo nível de
-- sensibilidade dos outros campos de store_fiscal_config (público,
-- allow_all_anon) — não é segredo.
alter table store_fiscal_config add column if not exists telefone text;
```

**Step 2: Aceitar no `/api/certificado`**

Em `app/api/certificado/route.ts`, junto dos outros `readOptionalString` de `store_fiscal_config` (perto de `inscricaoMunicipal`):

```ts
    const telefone = readOptionalString(form, 'telefone');
    if (telefone !== undefined) configFields.telefone = telefone;
```

**Step 3: Campo na UI (2 telas, mesmo padrão duplicado do resto do módulo fiscal)**

Em `AdminModule.tsx` e `StoreModule.tsx`, seção "Certificado e Configuração Fiscal" / "Identificação da empresa" (perto do campo de Inscrição Municipal): adicionar input `telefone` (texto livre, sem máscara — mesmo padrão dos outros campos dessa seção) e incluir no `FormData` enviado pro POST de `/api/certificado`, igual aos outros campos dessa seção.

**Step 4: Tipo e XML**

Em `lib/fiscal/xml.ts`, adicionar em `DadosEmitenteNota`:

```ts
export interface DadosEmitenteNota {
  // ...campos existentes...
  telefone?: string; // opcional — schema NFe aceita fone ausente
}
```

E no template de `enderEmit` (depois de `xPais`, ANTES de fechar `</enderEmit>` — ordem do schema NFe 4.00 é xLgr,nro,xCpl,xBairro,cMun,xMun,UF,CEP,cPais,xPais,fone):

```ts
    `<cPais>1058</cPais><xPais>BRASIL</xPais>` +
    (emitente.telefone ? `<fone>${emitente.telefone.replace(/\D/g, '')}</fone>` : '') +
    `</enderEmit><IE>${emitente.ie}</IE><CRT>1</CRT></emit>` +
```

**Step 5: Passar o dado na emissão**

Em `app/api/fiscal/emitir/route.ts`, no objeto `emitente` montado pra `montarXmlNota` (perto de `autXmlCnpj`):

```ts
        telefone: config.telefone || undefined,
```

**Step 6: Preencher o dado real da loja**

Depois do deploy, no painel do lojista/admin da loja "O Sertão Vai Virar Mar", preencher o campo Telefone com o número real do restaurante (não tenho esse dado — só quem administra o restaurante sabe).

**Step 7: Verificar**

Fechar outro pedido de teste, baixar o cupom, confirmar que "Fone: N/D" virou o telefone real.

**Step 8: Deploy** (mesmo padrão do Task 1 — commit, push, pull+build+restart no Contabo)

---

### Task 3 (bloqueado por ação externa): Tributos reais — Lei 12.741/2012

**Bloqueio real, não é código:** calcular o valor aproximado de tributos por Lei 12.741/2012 exige a tabela oficial do IBPT, que só é distribuída via cadastro gratuito em `deolhonoimposto.ibpt.org.br` (pessoa física ou jurídica responsável pela loja precisa se cadastrar e baixar a tabela — não encontrei API pública sem cadastro). **Isso não é algo que eu resolvo sozinho — precisa de alguém cadastrar a conta AMJ Santos lá e me passar a tabela baixada (CSV/planilha).**

Depois de ter a tabela em mãos:

**Files:**
- Create: `lib/fiscal/ibpt.ts` (lookup por NCM)
- Create: `data/ibpt-tabela.json` (tabela convertida — atualizar a cada trimestre, a lei exige)
- Modify: `lib/fiscal/xml.ts` (somar `vTotTrib` no bloco `<total><ICMSTot>`, logo depois de `<vNF>`, ANTES de `</ICMSTot>` — ordem do schema)
- Modify: `app/api/fiscal/emitir/route.ts` (calcular tributo por item, somar, passar pro `montarXmlNota`)

**Step 1: Converter a tabela do IBPT (formato deles é CSV com colunas NCM/ex/tipo/aliquota nacional/importado/estadual/municipal) pra um JSON simples `{ [ncm8digitos]: { federal: number, estadual: number, municipal: number } }` — aliquotas em % conforme baixado.**

**Step 2: `lib/fiscal/ibpt.ts`**

```ts
import tabela from '@/data/ibpt-tabela.json';

export function calcularTributoAproximado(ncm: string, valorItem: number) {
  const aliquota = (tabela as Record<string, { federal: number; estadual: number; municipal: number }>)[ncm];
  if (!aliquota) return { federal: 0, estadual: 0, municipal: 0, total: 0 };
  const federal = (valorItem * aliquota.federal) / 100;
  const estadual = (valorItem * aliquota.estadual) / 100;
  const municipal = (valorItem * aliquota.municipal) / 100;
  return { federal, estadual, municipal, total: federal + estadual + municipal };
}
```

**Step 3: Somar no route.ts, item por item, e passar o total pro `montarXmlNota` (novo parâmetro `vTotTrib`).**

**Step 4: `xml.ts` — inserir no bloco de totais, exatamente depois de `<vNF>${vNF}</vNF>` e antes de `</ICMSTot>` (ordem do schema NFe 4.00: vNF, vTotTrib):**

```ts
    `<vNF>${vNF}</vNF><vTotTrib>${vTotTrib.toFixed(2)}</vTotTrib></ICMSTot></total>` +
```

**Step 5: Isso só resolve o dado no XML — pra aparecer no cupom impresso ainda depende do Task 4 (a lib atual ignora `vTotTrib` de qualquer forma).**

---

### Task 4 (spike + implementação): Trocar a função de geração de DANFCe

**Motivo:** `node-sped-pdf` tem 3 valores hardcoded errados no template de DANFCe (protocolo, URL de consulta, tributos) — não dá pra corrigir passando dado diferente no XML, é preciso trocar a lib (ou só a função de renderização do cupom).

**Step 1 — Spike (antes de qualquer código real):** instalar `nfe-danfe-pdf` e `@nfewizard/danfe` num sandbox separado (não no projeto ainda), gerar um DANFCe de teste com o XML real já autorizado (`nota.xml` baixado nesta sessão, em homologação) e comparar visualmente:
- Mostra o protocolo real?
- URL de consulta correta pra BA/SVRS (não `sefaz.mt.gov.br`)?
- Lê `vTotTrib` se presente no XML (só faz sentido testar isso depois do Task 3)?
- Layout aceitável (48mm térmica, que é o padrão real de impressora de restaurante — `AGENTS.md` já documenta 48mm em outro contexto)?

**Step 2:** Escolher a lib vencedora, trocar em `lib/fiscal/pdf.ts` (`gerarPdfNota`) só a chamada da função de NFC-e — manter o resto do arquivo intacto se a lib nova não cobrir NF-e (modelo 55) tão bem.

**Step 3:** Reemitir uma nota de teste ponta a ponta (mesmo fluxo dos Tasks 1/2) e confirmar visualmente os 3 itens do Step 1.

**Step 4:** Deploy (mesmo padrão dos tasks anteriores).

---

## Resumo de prioridade sugerida

1. **Task 1** — sem bloqueio, resolve agora.
2. **Task 2** — sem bloqueio de terceiro, só precisa do telefone real da loja (perguntar ao dono/gerente).
3. **Task 4** — sem bloqueio externo, mas é o maior esforço de código (spike + troca de lib).
4. **Task 3** — bloqueado até alguém cadastrar a loja no IBPT e me passar a tabela; sem isso não tem como calcular tributo real (não vou inventar um valor).
