# Emissão Fiscal Automática (NFC-e/NF-e) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ao fechar mesa ou pedido de balcão no `ntb-vendas`, emitir automaticamente
NFC-e (modelo 65) ou NF-e (modelo 55) contra a SEFAZ real (Bahia, homologação por
padrão), usando o certificado digital e a configuração fiscal que a loja já
cadastrou.

**Architecture:** Módulo novo `lib/fiscal/` (puro, sem depender do Next.js) faz o
pipeline certificado → XML → assinatura → SOAP → PDF, generalizando o script já
validado `scripts/nfce-referencia/gerar-nfce-teste.mjs`. Uma rota de API nova
(`app/api/fiscal/emitir`, service role) orquestra esse pipeline e é chamada
fire-and-forget por `closeTableSession`/`closeCounterOrder`, no mesmo padrão já
usado por `app/api/integracao/ordem-producao`. Resultado (autorizada/erro) fica em
`fiscal_notas`, visível e reemitível numa aba nova do admin.

**Tech Stack:** Next.js 16 (Route Handlers, service role), Supabase (Postgres +
Storage), `node-forge` (parse de `.pfx`), `xml-crypto` (assinatura XMLDSig),
`node-sped-pdf` (DANFE/cupom).

**Nota sobre testes:** este projeto não tem framework de teste automatizado (sem
Jest/Vitest/pytest, confirmado — só testes manuais via UI e scripts scratch,
inclusive pra tudo que já foi validado contra a SEFAZ real). Este plano segue essa
convenção: onde a lógica é pura (chave de acesso, hash do QR Code), o passo de
verificação roda um snippet `node -e` reproduzindo valores **reais já logados no
`AGENTS.md`** (ex.: a chave de acesso `29260839912717000145650010000000011732405968`
autorizada em 04/08/2026) como "known-answer test" — não formaliza um test runner
novo, que seria escopo fora do pedido. O pipeline completo (assinatura + mTLS +
SOAP) só pode ser verificado de ponta a ponta contra a SEFAZ de homologação de
verdade (Task 18) — isso é inerente ao domínio, não uma lacuna do plano.

---

## Task 1: Migration — `products.ncm`

**Files:**
- Create: `supabase/migrations/032_ncm_produtos.sql`

**Step 1: Escrever a migration**

```sql
-- NCM (Nomenclatura Comum do Mercosul) por produto — obrigatório em qualquer
-- item de NFC-e/NF-e. Antes só existia um esboço de "padrões de imposto" por
-- LOJA (migration 025), sem classificação por produto — decisão explícita do
-- usuário em 2026-08-05: NCM correto por produto, não um padrão genérico pra
-- tudo (ver docs/superpowers/specs/2026-08-05-emissao-fiscal-automatica-design.md).
alter table products add column if not exists ncm text;
```

**Step 2: Aplicar no Supabase do projeto**

Rodar a migration contra o projeto Supabase de desenvolvimento (mesmo processo já
usado pras migrations anteriores deste repo — `supabase/migrations/README.md` ou
o fluxo que o projeto já usa pra aplicar SQL novo; não há CLI de migration
automática configurada aqui, confirmar aplicando manualmente via SQL editor ou
`psql` com a connection string do projeto).

**Step 3: Commit**

```bash
git add supabase/migrations/032_ncm_produtos.sql
git commit -m "feat: coluna ncm em products"
```

---

## Task 2: Campo NCM no cadastro de produto (admin)

**Files:**
- Modify: `types/index.ts` (interface `Product`)
- Modify: `lib/api.ts` (`createProduct`/`updateProduct`, RPC calls)
- Modify: `supabase/migrations/021_fecha_rls_orders_products.sql` — **não editar
  esse arquivo diretamente** (migration já aplicada); em vez disso criar uma nova
  migration que faz `create or replace function` das RPCs de produto incluindo
  `p_ncm`.
- Create: `supabase/migrations/033_ncm_em_create_update_product.sql`
- Modify: `components/modules/StoreModule.tsx` (formulário de produto)

**Step 1: Achar a assinatura atual das RPCs de produto**

```bash
grep -n "create_product_secure\|update_product_secure" -A 30 supabase/migrations/021_fecha_rls_orders_products.sql | head -80
```

Ler o `create or replace function` completo de `create_product_secure` e
`update_product_secure` nesse arquivo antes de escrever a migration nova — a
migration 033 precisa repetir a assinatura inteira (Postgres não permite
adicionar parâmetro no meio; o novo `p_ncm` entra no fim da lista de
parâmetros, com default, pra não quebrar chamadas existentes).

**Step 2: Escrever a migration 033**

Copiar o corpo de `create_product_secure`/`update_product_secure` da 021
(e de qualquer migration posterior que já tenha alterado essas functions —
conferir com `grep -rn "create_product_secure\|update_product_secure"
supabase/migrations/*.sql` pra achar a versão mais recente antes de basear a
cópia), adicionando:
- Parâmetro `p_ncm text default null` no fim da assinatura de ambas.
- `ncm` na lista de colunas do `insert into products` (create) e no
  `coalesce(p_ncm, ncm)` do `update` (mesmo padrão de update parcial já usado
  pros outros campos opcionais dessa function).
- `grant execute` repetido com a assinatura nova completa.

**Step 3: Aplicar a migration, adicionar o campo no formulário do produto**

Em `components/modules/StoreModule.tsx`, achar o formulário de criar/editar
produto (`grep -n "createProduct\|updateProduct" components/modules/StoreModule.tsx`)
e adicionar um `<input>` de texto "NCM" ao lado dos outros campos fiscais/de
estoque do produto, seguindo o mesmo padrão de `useState` + `onChange` já usado
nesse formulário.

**Step 4: Testar manualmente**

Rodar `npm run dev`, abrir o admin, cadastrar/editar um produto com NCM
preenchido, confirmar no Supabase (`select ncm from products where id = ...`)
que gravou.

**Step 5: Commit**

```bash
git add supabase/migrations/033_ncm_em_create_update_product.sql types/index.ts lib/api.ts components/modules/StoreModule.tsx
git commit -m "feat: campo NCM no cadastro de produto"
```

---

## Task 3: Migration — `modelo_emissao_automatica`, `chain_pem`, `fiscal_notas`, bucket

**Files:**
- Create: `supabase/migrations/034_fiscal_notas_e_emissao_automatica.sql`

**Step 1: Escrever a migration completa**

```sql
-- Emissão fiscal automática (2026-08-05) — ver
-- docs/superpowers/specs/2026-08-05-emissao-fiscal-automatica-design.md.

-- Loja escolhe qual modelo emite automaticamente ao fechar pedido. 'nenhuma'
-- (default) mantém o comportamento atual: nada é emitido.
alter table store_fiscal_config add column if not exists modelo_emissao_automatica text
  not null default 'nenhuma' check (modelo_emissao_automatica in ('nenhuma', 'nfce', 'nfe'));

-- Cadeia da AC intermediária em PEM, resolvida uma vez no upload do
-- certificado (não a cada emissão — ver seção "Arquitetura" da spec). Mesmo
-- nível de sensibilidade dos metadados de store_fiscal_certificates (não é
-- segredo — é público, tipo um certificado raiz).
alter table store_fiscal_certificates add column if not exists chain_pem text;

create table if not exists fiscal_notas (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  table_id uuid references tables(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  modelo text not null check (modelo in ('55', '65')),
  ambiente text not null check (ambiente in ('homologacao', 'producao')),
  status text not null check (status in ('pendente', 'autorizada', 'rejeitada', 'erro')),
  chave_acesso text,
  numero int,
  serie int,
  protocolo text,
  motivo_erro text,
  valor_total numeric(10,2),
  xml_path text,
  pdf_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table fiscal_notas enable row level security;

-- Leitura liberada pra anon/loja, mesmo nível de store_fiscal_certificates:
-- não é dado sigiloso, é histórico de vendas da própria loja (a UI do admin
-- precisa listar). Escrita só via service role (rota app/api/fiscal/emitir).
drop policy if exists "fiscal_notas_select_anon" on fiscal_notas;
create policy "fiscal_notas_select_anon" on fiscal_notas
  for select to anon, authenticated using (true);

create index if not exists fiscal_notas_store_id_idx on fiscal_notas(store_id);
create index if not exists fiscal_notas_status_idx on fiscal_notas(status);

-- Bucket privado dos documentos fiscais gerados (XML autorizado + PDF) —
-- mesmo padrão de store-certificates: sem policy de select/insert pra anon,
-- só a rota de servidor grava; download pelo admin via signed URL sob
-- demanda (nunca a URL pública direta).
insert into storage.buckets (id, name, public)
values ('fiscal-documentos', 'fiscal-documentos', false)
on conflict (id) do nothing;

-- Incremento atômico do número de NF-e/NFC-e — evita duas emissões
-- concorrentes (dois garçons fechando mesas ao mesmo tempo) colidirem no
-- mesmo número. p_modelo: '55' ou '65'.
create or replace function public.increment_fiscal_numero_secure(p_store_id uuid, p_modelo text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_novo int;
begin
  if p_modelo = '55' then
    update store_fiscal_config set nfe_ultimo_numero = nfe_ultimo_numero + 1, updated_at = now()
      where store_id = p_store_id
      returning nfe_ultimo_numero into v_novo;
  elsif p_modelo = '65' then
    update store_fiscal_config set nfce_ultimo_numero = nfce_ultimo_numero + 1, updated_at = now()
      where store_id = p_store_id
      returning nfce_ultimo_numero into v_novo;
  else
    raise exception 'modelo inválido: %', p_modelo;
  end if;

  if v_novo is null then
    raise exception 'store_fiscal_config não encontrado pra store_id %', p_store_id;
  end if;

  return v_novo;
end;
$$;

grant execute on function public.increment_fiscal_numero_secure(uuid, text) to service_role;
```

**Step 2: Aplicar a migration, conferir**

```sql
select modelo_emissao_automatica from store_fiscal_config limit 1;
select * from fiscal_notas limit 1;
select public.increment_fiscal_numero_secure('<um store_id de teste>', '65');
```
Esperado: a última linha devolve `1` (ou o próximo número), e
`store_fiscal_config.nfce_ultimo_numero` daquela loja incrementou.

**Step 3: Commit**

```bash
git add supabase/migrations/034_fiscal_notas_e_emissao_automatica.sql
git commit -m "feat: schema de fiscal_notas, modelo_emissao_automatica e numeração atômica"
```

---

## Task 4: Instalar dependências novas

**Files:**
- Modify: `package.json`, `package-lock.json`

**Step 1: Instalar**

```bash
npm install node-forge xml-crypto node-sped-pdf
npm install -D @types/node-forge
```

**Step 2: Confirmar que o build ainda passa**

```bash
npm run build
```
Esperado: build conclui sem erro (as libs novas ainda não são importadas em
nenhum lugar, então isso só confirma que a instalação não quebrou nada).

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: dependências de emissão fiscal (node-forge, xml-crypto, node-sped-pdf)"
```

---

## Task 5: `lib/fiscal/chaveAcesso.ts` — chave de acesso (módulo 11)

Lógica pura, mesma fórmula do `scripts/nfce-referencia/gerar-nfce-teste.mjs`
(`calcDV`), extraída pra função reutilizável e coberta com um known-answer test
usando uma chave real já autorizada (logada no `AGENTS.md`, 2026-08-04).

**Files:**
- Create: `lib/fiscal/chaveAcesso.ts`

**Step 1: Implementar**

```typescript
// Chave de acesso de 44 dígitos da NFe/NFCe: cUF+AAMM+CNPJ+mod+serie+nNF+
// tpEmis+cNF+DV, DV calculado por módulo 11 (pesos 2..9 ciclando da direita
// pra esquerda). Mesma fórmula já validada contra a SEFAZ real em
// scripts/nfce-referencia/gerar-nfce-teste.mjs.
export function calcularDigitoVerificador(chave43: string): number {
  let soma = 0;
  let peso = 2;
  for (const d of chave43.split('').reverse().map(Number)) {
    soma += d * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

const pad = (n: number | string, len: number) => String(n).padStart(len, '0');

export interface DadosChaveAcesso {
  cUF: number;
  anoMes: string; // AAMM, ex.: '2608'
  cnpj: string; // 14 dígitos, só números
  modelo: '55' | '65';
  serie: number;
  numero: number;
  tpEmis?: number; // default 1 (emissão normal)
  cNF?: string; // 8 dígitos; gerado aleatório se ausente
}

export function montarChaveAcesso(dados: DadosChaveAcesso): { chave: string; cNF: string } {
  const cNF = dados.cNF ?? pad(Math.floor(Math.random() * 99999999), 8);
  const tpEmis = dados.tpEmis ?? 1;
  const semDV =
    `${pad(dados.cUF, 2)}${dados.anoMes}${pad(dados.cnpj, 14)}${dados.modelo}` +
    `${pad(dados.serie, 3)}${pad(dados.numero, 9)}${tpEmis}${cNF}`;
  const dv = calcularDigitoVerificador(semDV);
  return { chave: semDV + dv, cNF };
}
```

**Step 2: Verificar contra uma chave real autorizada (known-answer)**

A chave `29260839912717000145650010000000011732405968`, autorizada pela SEFAZ
(NFC-e, `cStat=100`) em 2026-08-04, está logada em `AGENTS.md`. Rodar:

```bash
node -e "
const { calcularDigitoVerificador } = require('./lib/fiscal/chaveAcesso.ts');
" 2>&1 || true
```

Como é TypeScript, verificar direto com um script scratch:

```bash
cat > /tmp/verifica-chave.mjs <<'EOF'
function calcularDV(chave43) {
  let soma = 0, peso = 2;
  for (const d of chave43.split('').reverse().map(Number)) {
    soma += d * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}
const chaveReal = '29260839912717000145650010000000011732405968';
const semDV = chaveReal.slice(0, 43);
const dvEsperado = Number(chaveReal.slice(43));
console.log('DV calculado:', calcularDV(semDV), '| DV esperado:', dvEsperado);
EOF
node /tmp/verifica-chave.mjs
```
Esperado: `DV calculado: X | DV esperado: X` — os dois números batem. Se não
baterem, a fórmula em `chaveAcesso.ts` tem um bug antes mesmo de chegar perto da
SEFAZ.

**Step 3: Commit**

```bash
git add lib/fiscal/chaveAcesso.ts
git commit -m "feat: lib/fiscal/chaveAcesso — chave de acesso e DV módulo 11"
```

---

## Task 6: `lib/fiscal/certificado.ts` — extrair cert/chave do `.pfx`

**Files:**
- Create: `lib/fiscal/certificado.ts`

**Step 1: Implementar extração via `node-forge`**

```typescript
import forge from 'node-forge';

export interface CertificadoExtraido {
  certPem: string;
  keyPem: string;
  /** CN/subject do certificado — útil pra validar CNPJ ao emitir. */
  cnpjCertificado: string | null;
  /** URL do "CA Issuers" (Authority Information Access), pra resolver a cadeia. */
  urlCaIssuer: string | null;
}

// Extrai o certificado "folha" + chave privada de um .pfx (e-CNPJ A1),
// convertendo pra PEM (o Node não parseia PKCS12 nativamente em cert+key
// separados — por isso node-forge). Mesmo procedimento que antes era feito
// na mão com `openssl pkcs12 -clcerts`/`-nocerts` (ver histórico em
// scripts/nfce-referencia/gerar-nfce-teste.mjs).
export function extrairCertificado(pfxBuffer: Buffer, senha: string): CertificadoExtraido {
  const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer.toString('binary')));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];

  const certBag = certBags[0];
  const keyBag = keyBags[0];
  if (!certBag?.cert || !keyBag?.key) {
    throw new Error('Certificado ou chave privada não encontrados no .pfx.');
  }

  const cert = certBag.cert;
  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keyBag.key);

  const cnpjAttr = cert.subject.attributes.find((a) => a.shortName === 'CN')?.value as string | undefined;
  const cnpjMatch = cnpjAttr?.match(/(\d{14})/);

  // Authority Information Access — extension 1.3.6.1.5.5.7.1.1, campo
  // "CA Issuers" (accessMethod 1.3.6.1.5.5.7.48.2). node-forge não decodifica
  // essa extensão em alto nível; extrai a URL do valor bruto (DER) com uma
  // busca simples por "http" no ASN.1 codificado.
  const aiaExt = cert.extensions.find((e) => e.id === '1.3.6.1.5.5.7.1.1');
  let urlCaIssuer: string | null = null;
  if (aiaExt?.value) {
    const match = aiaExt.value.match(/https?:\/\/[^\x00-\x1f\x7f]+/);
    urlCaIssuer = match?.[0] ?? null;
  }

  return { certPem, keyPem, cnpjCertificado: cnpjMatch?.[1] ?? null, urlCaIssuer };
}

// Baixa o certificado da AC emissora (.p7b ou .cer, formato varia por AC) e
// devolve em PEM, pra concatenar com o certPem da loja. Chamado só no upload
// do certificado (Task 7), não a cada emissão.
export async function resolverCadeiaCertificado(urlCaIssuer: string): Promise<string> {
  const res = await fetch(urlCaIssuer);
  if (!res.ok) throw new Error(`Falha ao baixar certificado da AC emissora: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());

  // A maioria das ACs brasileiras serve .p7b (PKCS7, DER). node-forge decodifica
  // e extrai os certificados de dentro.
  try {
    const p7Asn1 = forge.asn1.fromDer(forge.util.createBuffer(bytes.toString('binary')));
    const p7 = forge.pkcs7.messageFromAsn1(p7Asn1) as forge.pkcs7.PkcsSignedData;
    const certs = p7.certificates ?? [];
    if (!certs.length) throw new Error('Nenhum certificado dentro do .p7b da AC.');
    return certs.map((c) => forge.pki.certificateToPem(c)).join('\n');
  } catch (e) {
    // Fallback: algumas ACs servem .cer (certificado único em DER), não p7b.
    const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(bytes.toString('binary'))));
    return forge.pki.certificateToPem(cert);
  }
}
```

**Step 2: Verificação manual com um certificado de teste**

Sem um `.pfx` real disponível em CI, a verificação desta função é manual, na
Task 12 (upload de certificado real) e na Task 18 (emissão ponta a ponta) — não
dá pra fazer sentido de um known-answer test aqui sem expor segredo real. Deixar
anotado no PR/commit que esta função só é validada de fato quando a Task 12
rodar contra um certificado real de loja (fora do repo, mesmo princípio de
sempre).

**Step 3: Commit**

```bash
git add lib/fiscal/certificado.ts
git commit -m "feat: lib/fiscal/certificado — extração de cert/chave do .pfx via node-forge"
```

---

## Task 7: Cadeia do certificado resolvida no upload (`/api/certificado`)

**Files:**
- Modify: `app/api/certificado/route.ts`

**Step 1: Ler o arquivo atual completo**

Já lido durante o brainstorm — `POST` faz upload do `.pfx` pro bucket
`store-certificates` e upsert em `store_fiscal_certificates`. Adicionar, logo
depois do upload bem-sucedido do arquivo (dentro do `if (file instanceof File)`):

```typescript
    if (file instanceof File) {
      const path = `${storeId}/certificado.pfx`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const { error } = await supabaseAdmin.storage.from(CERT_BUCKET).upload(path, buffer, {
        upsert: true,
        contentType: 'application/x-pkcs12',
      });
      if (error) throw new Error(error.message);

      // Resolve a cadeia da AC intermediária uma vez, no upload — não em toda
      // emissão (ver docs/superpowers/specs/2026-08-05-emissao-fiscal-automatica-design.md).
      // A senha pode não ter vindo nesta mesma requisição (upload de arquivo
      // separado da troca de senha, no form do admin) — nesse caso, tenta ler
      // a senha já salva antes de desistir de montar a cadeia.
      let senhaParaCadeia = typeof password === 'string' && password ? password : undefined;
      if (!senhaParaCadeia) {
        const { data: secretExistente } = await supabaseAdmin
          .from('store_fiscal_certificate_secrets')
          .select('password')
          .eq('store_id', storeId)
          .maybeSingle();
        senhaParaCadeia = secretExistente?.password;
      }

      if (senhaParaCadeia) {
        try {
          const { urlCaIssuer } = extrairCertificado(buffer, senhaParaCadeia);
          if (urlCaIssuer) {
            const chainPem = await resolverCadeiaCertificado(urlCaIssuer);
            await supabaseAdmin
              .from('store_fiscal_certificates')
              .update({ chain_pem: chainPem })
              .eq('store_id', storeId);
          }
        } catch (e) {
          // Não falha o upload do certificado por isso — a cadeia pode ser
          // resolvida de novo depois (ex.: reenviando o certificado, ou numa
          // futura tela de "recalcular cadeia"). Só loga.
          console.error('Falha ao resolver cadeia do certificado:', e);
        }
      }
    }
```

Adicionar o import no topo:
```typescript
import { extrairCertificado, resolverCadeiaCertificado } from '@/lib/fiscal/certificado';
```

**Step 2: Testar manualmente**

Com um certificado de teste real (fora do repo, mesmo princípio de sempre — não
usar certificado de loja de produção pra isso), fazer upload pela UI do admin e
conferir:
```sql
select store_id, chain_pem is not null as tem_cadeia from store_fiscal_certificates;
```
Esperado: `tem_cadeia = true` pra loja testada.

**Step 3: Commit**

```bash
git add app/api/certificado/route.ts
git commit -m "feat: resolve cadeia da AC intermediária no upload do certificado"
```

---

## Task 8: `lib/fiscal/xml.ts` — construção do XML (NFC-e e NF-e)

Generaliza o XML hardcoded do script de referência pra múltiplos itens e pros
dois modelos, parametrizado pelos dados reais do pedido + config da loja.

**Files:**
- Create: `lib/fiscal/xml.ts`

**Step 1: Implementar**

```typescript
import { montarChaveAcesso } from './chaveAcesso';

export interface ItemNota {
  cProd: string; // código do produto (pode ser o id truncado ou omie_codigo)
  xProd: string; // descrição
  ncm: string;
  qCom: number;
  vUnCom: number;
  cfop?: string; // default 5102
}

export interface DestinatarioNota {
  cpfCnpj: string;
  nome: string;
}

export interface DadosEmitenteNota {
  cnpj: string;
  ie: string;
  razaoSocial: string;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  cMun: string; // código IBGE
  uf: string;
  cep: string;
  cUF: number; // código IBGE da UF (29 = BA)
  cstCsosnPadrao: string;
  cstPisPadrao: string;
  cstCofinsPadrao: string;
  autXmlCnpj?: string; // exigência específica da BA — CNPJ do escritório de contabilidade
}

export interface MontarXmlParams {
  modelo: '55' | '65';
  ambiente: 'homologacao' | 'producao';
  serie: number;
  numero: number;
  emitente: DadosEmitenteNota;
  itens: ItemNota[];
  destinatario?: DestinatarioNota; // obrigatório pra modelo 55, ausente pra 65
}

const pad = (n: number | string, len: number) => String(n).padStart(len, '0');

// Texto obrigatório em homologação (SEFAZ rejeita sem isso). Pra NFC-e (sem
// <dest>), vai no xProd do primeiro item; pra NF-e, no xNome do <dest> — ver
// histórico em AGENTS.md (2026-08-04) sobre qual campo é o certo pra cada modelo.
const AVISO_HOMOLOGACAO = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

export function montarXmlNota(params: MontarXmlParams): { xml: string; chave: string; infNFeId: string } {
  const { modelo, ambiente, serie, numero, emitente, itens, destinatario } = params;
  if (!itens.length) throw new Error('Nota sem itens.');
  if (modelo === '55' && !destinatario) throw new Error('NF-e (modelo 55) exige destinatário.');

  const tpAmb = ambiente === 'homologacao' ? 2 : 1;
  const now = new Date();
  const anoMes = pad(now.getFullYear() % 100, 2) + pad(now.getMonth() + 1, 2);

  const { chave, cNF } = montarChaveAcesso({
    cUF: emitente.cUF,
    anoMes,
    cnpj: emitente.cnpj,
    modelo,
    serie,
    numero,
  });

  const dhEmi =
    `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}` +
    `T${pad(now.getHours(), 2)}:${pad(now.getMinutes(), 2)}:${pad(now.getSeconds(), 2)}-03:00`;

  const infNFeId = `NFe${chave}`;

  let vProdTotal = 0;
  const detXml = itens
    .map((item, i) => {
      const vProd = Number((item.qCom * item.vUnCom).toFixed(2));
      vProdTotal += vProd;
      const xProd =
        tpAmb === 2 && i === 0 && modelo === '65' ? `${item.xProd} - ${AVISO_HOMOLOGACAO}` : item.xProd;
      return (
        `<det nItem="${i + 1}"><prod><cProd>${item.cProd}</cProd><cEAN>SEM GTIN</cEAN><xProd>${xProd}</xProd>` +
        `<NCM>${item.ncm}</NCM><CFOP>${item.cfop ?? '5102'}</CFOP><uCom>UN</uCom>` +
        `<qCom>${item.qCom.toFixed(4)}</qCom><vUnCom>${item.vUnCom.toFixed(10)}</vUnCom>` +
        `<vProd>${vProd.toFixed(2)}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib>` +
        `<qTrib>${item.qCom.toFixed(4)}</qTrib><vUnTrib>${item.vUnCom.toFixed(10)}</vUnTrib><indTot>1</indTot></prod>` +
        `<imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>${emitente.cstCsosnPadrao}</CSOSN></ICMSSN102></ICMS>` +
        `<PIS><PISNT><CST>${emitente.cstPisPadrao}</CST></PISNT></PIS>` +
        `<COFINS><COFINSNT><CST>${emitente.cstCofinsPadrao}</CST></COFINSNT></COFINS></imposto></det>`
      );
    })
    .join('');

  const destXml = destinatario
    ? (() => {
        const doc = destinatario.cpfCnpj.replace(/\D/g, '');
        const tagDoc = doc.length === 14 ? 'CNPJ' : 'CPF';
        const xNome = tpAmb === 2 ? `${destinatario.nome} - ${AVISO_HOMOLOGACAO}` : destinatario.nome;
        return `<dest><${tagDoc}>${doc}</${tagDoc}><xNome>${xNome}</xNome><indIEDest>9</indIEDest></dest>`;
      })()
    : '';

  // autXML antes de det (ordem do schema — ver AGENTS.md, "autXML depois de
  // pag dá cStat=225 Falha no Schema XML"). Só entra se a loja configurou um
  // CNPJ de escritório de contabilidade; senão a BA aceita sem esse grupo
  // pra quem não é obrigado (confirmar caso a caso — ver cStat=486 no histórico).
  const autXmlXml = emitente.autXmlCnpj ? `<autXML><CNPJ>${emitente.autXmlCnpj}</CNPJ></autXML>` : '';

  const vNF = vProdTotal.toFixed(2);

  const nfeXml =
    `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="${infNFeId}" versao="4.00">` +
    `<ide><cUF>${emitente.cUF}</cUF><cNF>${cNF}</cNF><natOp>VENDA AO CONSUMIDOR</natOp><mod>${modelo}</mod>` +
    `<serie>${serie}</serie><nNF>${numero}</nNF><dhEmi>${dhEmi}</dhEmi><tpNF>1</tpNF>` +
    `<idDest>${destinatario ? 1 : 1}</idDest><cMunFG>${emitente.cMun}</cMunFG>` +
    `<tpImp>${modelo === '65' ? 4 : 1}</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV>` +
    `<tpAmb>${tpAmb}</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres>` +
    `<procEmi>0</procEmi><verProc>ntb-vendas-1.0</verProc></ide>` +
    `<emit><CNPJ>${emitente.cnpj}</CNPJ><xNome>${emitente.razaoSocial}</xNome>` +
    `<enderEmit><xLgr>${emitente.logradouro}</xLgr><nro>${emitente.numero}</nro><xBairro>${emitente.bairro}</xBairro>` +
    `<cMun>${emitente.cMun}</cMun><xMun>${emitente.municipio}</xMun><UF>${emitente.uf}</UF><CEP>${emitente.cep}</CEP>` +
    `<cPais>1058</cPais><xPais>BRASIL</xPais></enderEmit><IE>${emitente.ie}</IE><CRT>1</CRT></emit>` +
    destXml +
    autXmlXml +
    detXml +
    `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP>` +
    `<vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${vNF}</vProd>` +
    `<vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI>` +
    `<vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro>` +
    `<vNF>${vNF}</vNF></ICMSTot></total><transp><modFrete>9</modFrete></transp>` +
    `<pag><detPag><indPag>0</indPag><tPag>01</tPag><vPag>${vNF}</vPag></detPag></pag>` +
    `</infNFe></NFe>`;

  return { xml: nfeXml, chave, infNFeId };
}
```

**Step 2: Verificação manual (estrutura + total)**

```bash
cat > /tmp/testa-xml.mjs <<'EOF'
// roda com tsx ou ts-node se disponível; senão, confirmar manualmente lendo
// o XML gerado numa emissão real de teste na Task 18.
EOF
```
Não há como validar esquema XSD sem as libs oficiais da Receita — a validação
real acontece no `cStat` de volta da SEFAZ (Task 18). Aqui, conferir só que
`vNF` bate com a soma manual dos itens de teste antes de seguir.

**Step 3: Commit**

```bash
git add lib/fiscal/xml.ts
git commit -m "feat: lib/fiscal/xml — monta XML de NFC-e/NF-e a partir dos itens do pedido"
```

---

## Task 9: `lib/fiscal/assinatura.ts` — assinatura XMLDSig

**Files:**
- Create: `lib/fiscal/assinatura.ts`

**Step 1: Implementar (wrapper direto do que já foi validado no script de referência)**

```typescript
import { SignedXml } from 'xml-crypto';

// Assinatura XMLDSig enveloped, padrão NFe: C14N + SHA1/RSA-SHA1 (padrão
// histórico da SEFAZ — não é escolha nossa, é exigência do schema). Mesma
// receita já confirmada contra a SEFAZ real em scripts/nfce-referencia/gerar-nfce-teste.mjs.
export function assinarXmlNota(xml: string, infNFeId: string, certPem: string, keyPem: string): string {
  const sig = new SignedXml({ privateKey: keyPem, publicCert: certPem });
  sig.addReference({
    xpath: `//*[local-name(.)='infNFe']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    uri: `#${infNFeId}`,
  });
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
  sig.computeSignature(xml, { location: { reference: `//*[local-name(.)='infNFe']`, action: 'after' } });
  return sig.getSignedXml();
}
```

**Step 2: Commit**

```bash
git add lib/fiscal/assinatura.ts
git commit -m "feat: lib/fiscal/assinatura — wrapper de assinatura XMLDSig"
```

---

## Task 10: `lib/fiscal/qrcode.ts` — QR Code da NFC-e

**Files:**
- Create: `lib/fiscal/qrcode.ts`

**Step 1: Implementar**

```typescript
import crypto from 'node:crypto';

export interface DadosQrCode {
  chave: string;
  tpAmb: 2 | 1;
  idCsc: string; // sem zeros à esquerda na fórmula, mas pode vir com eles do banco
  csc: string;
  urlQrCode: string; // endpoint de consulta do QR (varia por UF/ambiente)
  urlChave: string; // endpoint de consulta por chave (varia por UF/ambiente)
}

// Versão 2, modo online: p=<chave>|2|<tpAmb>|<idCSC sem zeros à esquerda>|
// <SHA1 maiúsculo de "<chave>|2|<tpAmb>|<idCSC>"+CSC>. A SEFAZ valida esse
// hash de verdade (CSC errado devolve cStat=464) — confirmado em 2026-08-04.
export function montarQrCode(dados: DadosQrCode): { qrCode: string; supl: string } {
  const idCscSemZeros = String(Number(dados.idCsc));
  const params = `${dados.chave}|2|${dados.tpAmb}|${idCscSemZeros}`;
  const hash = crypto.createHash('sha1').update(params + dados.csc, 'utf8').digest('hex').toUpperCase();
  const qrCode = `${dados.urlQrCode}?p=${params}|${hash}`;

  // infNFeSupl entra ENTRE infNFe e Signature (ordem do schema) — inserir
  // depois de assinar não invalida nada, o digest cobre só o subtree de infNFe.
  const supl = `<infNFeSupl><qrCode><![CDATA[${qrCode}]]></qrCode><urlChave>${dados.urlChave}</urlChave></infNFeSupl>`;
  return { qrCode, supl };
}

export function inserirSuplNoXmlAssinado(xmlAssinado: string, supl: string): string {
  return xmlAssinado.replace('<Signature', supl + '<Signature');
}
```

**Step 2: Known-answer test manual**

```bash
cat > /tmp/verifica-qr.mjs <<'EOF'
import crypto from 'node:crypto';
// Reproduz a fórmula com valores fictícios — sem CSC real disponível fora do
// vault da loja, o teste aqui é só de FORMATO (o teste de verdade é a Task 18
// contra a SEFAZ real, que já validou essa fórmula em 2026-08-04).
const chave = '29260839912717000145650010000000011732405968';
const params = `${chave}|2|2|1`;
const hash = crypto.createHash('sha1').update(params + 'CSC-FICTICIO').digest('hex').toUpperCase();
console.log(`${params}|${hash}`);
EOF
node /tmp/verifica-qr.mjs
```
Esperado: uma string no formato `<chave>|2|2|1|<40 caracteres hex maiúsculos>`
— confirma só a forma, não o valor (isso depende do CSC real de cada loja).

**Step 3: Commit**

```bash
git add lib/fiscal/qrcode.ts
git commit -m "feat: lib/fiscal/qrcode — QR Code da NFC-e (fórmula v2 online)"
```

---

## Task 11: `lib/fiscal/soap.ts` — endpoints e transmissão

**Files:**
- Create: `lib/fiscal/soap.ts`

**Step 1: Implementar**

```typescript
export interface EndpointsSefaz {
  autorizacao: string;
}

// Endpoints da Bahia — modelo 55 na infraestrutura própria da BA, modelo 65
// delegado pra SEFAZ Virtual do RS (SVRS). Confirmado por teste real em
// 2026-08-04 (ver AGENTS.md) depois de 3 tentativas erradas mandando modelo
// 65 pro endpoint de modelo 55. Isolado aqui pra facilitar adicionar outras
// UFs depois sem mexer no resto do pipeline — hoje só BA está implementado.
const ENDPOINTS: Record<'55' | '65', Record<'homologacao' | 'producao', EndpointsSefaz>> = {
  '55': {
    homologacao: { autorizacao: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx' },
    producao: { autorizacao: 'https://nfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx' },
  },
  '65': {
    homologacao: { autorizacao: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx' },
    producao: { autorizacao: 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx' },
  },
};

export function resolverEndpoint(modelo: '55' | '65', ambiente: 'homologacao' | 'producao'): EndpointsSefaz {
  return ENDPOINTS[modelo][ambiente];
}

export interface RespostaSefaz {
  httpStatus: number;
  cStat: string | null;
  xMotivo: string | null;
  protocolo: string | null;
  xmlBruto: string;
}

// Envelope SOAP 1.2 + envio via mTLS (cert+key do certificado da loja,
// rejectUnauthorized:false porque o bundle de CA do Node não traz a cadeia
// ICP-Brasil — mesmo ajuste já validado no script de referência).
export async function transmitirNota(params: {
  modelo: '55' | '65';
  ambiente: 'homologacao' | 'producao';
  xmlAssinadoComSupl: string;
  certPem: string;
  keyPem: string;
}): Promise<RespostaSefaz> {
  const { modelo, ambiente, xmlAssinadoComSupl, certPem, keyPem } = params;
  const endpoint = resolverEndpoint(modelo, ambiente);

  const enviNFe =
    `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<idLote>1</idLote><indSinc>1</indSinc>${xmlAssinadoComSupl}</enviNFe>`;

  const soapBody =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${enviNFe}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;

  const https = await import('node:https');
  const u = new URL(endpoint.autorizacao);

  const xmlBruto = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: 'POST',
        cert: certPem,
        key: keyPem,
        rejectUnauthorized: false,
        headers: {
          'Content-Type':
            'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',
          'Content-Length': Buffer.byteLength(soapBody),
        },
        timeout: 30000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout na transmissão pra SEFAZ.'));
    });
    req.write(soapBody);
    req.end();
  });

  const cStat = xmlBruto.match(/<cStat>(\d+)<\/cStat>/)?.[1] ?? null;
  const xMotivo = xmlBruto.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] ?? null;
  const protocolo = xmlBruto.match(/<nProt>([^<]+)<\/nProt>/)?.[1] ?? null;

  return { httpStatus: 200, cStat, xMotivo, protocolo, xmlBruto };
}
```

**Step 2: Verificação manual**

Endpoints conferidos direto contra o texto já logado no `AGENTS.md`
("Atualização 2026-08-04" e "Atualização 2026-08-03") — não precisa de chamada
de rede pra essa etapa; a chamada real só acontece na Task 18.

**Step 3: Commit**

```bash
git add lib/fiscal/soap.ts
git commit -m "feat: lib/fiscal/soap — endpoints SEFAZ-BA/SVRS e transmissão via mTLS"
```

---

## Task 12: `lib/fiscal/pdf.ts` — DANFE/cupom

**Files:**
- Create: `lib/fiscal/pdf.ts`

**Step 1: Implementar**

```typescript
// node-sped-pdf já validado gerando PDF de verdade a partir de nfeProc real
// em 2026-08-04 (DANFe pra NF-e, DANFCe pra NFC-e) — ver AGENTS.md.
import { DANFe, DANFCe } from 'node-sped-pdf';

export async function gerarPdfNota(modelo: '55' | '65', nfeProcXml: string): Promise<Buffer> {
  const gerar = modelo === '55' ? DANFe : DANFCe;
  const resultado = await gerar({ xml: nfeProcXml });
  // node-sped-pdf devolve Buffer ou base64 dependendo da versão — confirmar
  // o shape real na Task 18 (primeira execução ponta a ponta) e ajustar aqui
  // se vier como string base64 em vez de Buffer.
  return Buffer.isBuffer(resultado) ? resultado : Buffer.from(resultado as unknown as string, 'base64');
}

export function montarNfeProc(xmlAssinadoComSupl: string, protXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${xmlAssinadoComSupl}${protXml}</nfeProc>`;
}
```

**Step 2: Commit**

```bash
git add lib/fiscal/pdf.ts
git commit -m "feat: lib/fiscal/pdf — geração de DANFE/cupom via node-sped-pdf"
```

**Nota:** o shape exato do retorno de `DANFe`/`DANFCe` (Buffer vs string) só se
confirma rodando de verdade — ajustar nesta mesma task se a Task 18 mostrar
que o `Buffer.isBuffer` está errado, antes de seguir pra produção.

---

## Task 13: `app/api/fiscal/emitir/route.ts` — orquestração

**Files:**
- Create: `app/api/fiscal/emitir/route.ts`

**Step 1: Implementar, seguindo o padrão de `app/api/integracao/ordem-producao/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { extrairCertificado } from '@/lib/fiscal/certificado';
import { montarXmlNota, ItemNota } from '@/lib/fiscal/xml';
import { assinarXmlNota } from '@/lib/fiscal/assinatura';
import { montarQrCode, inserirSuplNoXmlAssinado } from '@/lib/fiscal/qrcode';
import { transmitirNota } from '@/lib/fiscal/soap';
import { gerarPdfNota, montarNfeProc } from '@/lib/fiscal/pdf';

interface RequestBody {
  orderId?: string;
  tableId?: string;
}

// Fire-and-forget: chamado por closeTableSession/closeCounterOrder depois que
// o pedido já fechou de verdade. Nunca deve impedir o fechamento — qualquer
// falha grava fiscal_notas com status 'erro'/'pendente' e devolve 200, mesmo
// princípio de app/api/integracao/ordem-producao.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body?.orderId && !body?.tableId) {
    return NextResponse.json({ skipped: true, reason: 'orderId ou tableId ausente' });
  }

  const admin = getSupabaseAdmin();

  // 1. Resolve store_id e os itens da venda.
  let storeId: string | null = null;
  let orderIds: string[] = [];

  if (body.orderId) {
    const { data: order } = await admin.from('orders').select('id, store_id').eq('id', body.orderId).maybeSingle();
    if (order) {
      storeId = order.store_id;
      orderIds = [order.id];
    }
  } else if (body.tableId) {
    const { data: orders } = await admin
      .from('orders')
      .select('id, store_id')
      .eq('table_id', body.tableId)
      .eq('status', 'delivered')
      .gte('updated_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());
    if (orders?.length) {
      storeId = orders[0].store_id;
      orderIds = orders.map((o) => o.id);
    }
  }

  if (!storeId || !orderIds.length) {
    return NextResponse.json({ skipped: true, reason: 'Pedido(s) não encontrado(s)' });
  }

  // 2. Config da loja — decide SE emite e QUAL modelo.
  const { data: config } = await admin.from('store_fiscal_config').select('*').eq('store_id', storeId).maybeSingle();
  if (!config || config.modelo_emissao_automatica === 'nenhuma') {
    return NextResponse.json({ skipped: true, reason: 'Loja sem emissão automática configurada' });
  }
  const modelo: '55' | '65' = config.modelo_emissao_automatica === 'nfe' ? '55' : '65';
  const serie = modelo === '55' ? config.nfe_serie : config.nfce_serie;
  if (!serie) {
    return NextResponse.json({ skipped: true, reason: `Série do modelo ${modelo} não configurada` });
  }

  // 3. Certificado + senha + cadeia.
  const { data: certMeta } = await admin
    .from('store_fiscal_certificates')
    .select('file_path, chain_pem')
    .eq('store_id', storeId)
    .maybeSingle();
  const { data: certSecret } = await admin
    .from('store_fiscal_certificate_secrets')
    .select('password')
    .eq('store_id', storeId)
    .maybeSingle();

  if (!certMeta || !certSecret?.password) {
    return NextResponse.json({ skipped: true, reason: 'Loja sem certificado digital configurado' });
  }

  // 4. Itens da venda (com NCM do produto).
  const { data: items } = await admin
    .from('order_items')
    .select('quantity, status, price_at_time, product:products(id, name, ncm)')
    .in('order_id', orderIds);

  const itensValidos = (items ?? []).filter((i) => i.status !== 'canceled');
  if (!itensValidos.length) {
    return NextResponse.json({ skipped: true, reason: 'Nenhum item pra emitir' });
  }

  const itemSemNcm = itensValidos.find((i) => !(i as any).product?.ncm);
  const valorTotal = itensValidos.reduce((soma, i) => soma + i.quantity * Number(i.price_at_time), 0);

  const notaBase = {
    store_id: storeId,
    table_id: body.tableId ?? null,
    order_id: body.tableId ? null : orderIds[0],
    modelo,
    ambiente: config.ambiente as 'homologacao' | 'producao',
    valor_total: valorTotal,
  };

  if (itemSemNcm) {
    await admin.from('fiscal_notas').insert({
      ...notaBase,
      status: 'erro',
      motivo_erro: `Produto "${(itemSemNcm as any).product?.name}" sem NCM cadastrado.`,
    });
    return NextResponse.json({ ok: false, reason: 'Item sem NCM' });
  }

  try {
    // 5. Numeração atômica.
    const { data: numero } = await admin.rpc('increment_fiscal_numero_secure', {
      p_store_id: storeId,
      p_modelo: modelo,
    });

    // 6. Monta itens do XML.
    const itensXml: ItemNota[] = itensValidos.map((i) => ({
      cProd: String((i as any).product.id).slice(0, 8),
      xProd: (i as any).product.name,
      ncm: (i as any).product.ncm,
      qCom: i.quantity,
      vUnCom: Number(i.price_at_time),
    }));

    // 7. Certificado.
    const certBucket = admin.storage.from('store-certificates');
    const { data: pfxFile } = await certBucket.download(certMeta.file_path);
    if (!pfxFile) throw new Error('Não foi possível baixar o certificado digital.');
    const pfxBuffer = Buffer.from(await pfxFile.arrayBuffer());
    const { certPem, keyPem } = extrairCertificado(pfxBuffer, certSecret.password);
    const certComCadeia = certMeta.chain_pem ? `${certPem}\n${certMeta.chain_pem}` : certPem;

    // 8. Monta e assina o XML.
    const { xml, chave, infNFeId } = montarXmlNota({
      modelo,
      ambiente: config.ambiente,
      serie,
      numero,
      emitente: {
        cnpj: (config.cnpj_autorizado || '').replace(/\D/g, ''),
        ie: config.inscricao_estadual || '',
        razaoSocial: config.razao_social || '',
        logradouro: config.endereco_logradouro || '',
        numero: config.endereco_numero || 'S/N',
        bairro: config.endereco_bairro || '',
        municipio: config.endereco_cidade || '',
        cMun: '2921005', // TODO: mapear UF/município -> código IBGE quando expandir além da BA/Mata de São João
        uf: config.endereco_uf || 'BA',
        cep: (config.endereco_cep || '').replace(/\D/g, ''),
        cUF: 29,
        cstCsosnPadrao: config.cst_csosn_padrao || '102',
        cstPisPadrao: config.cst_pis_padrao || '07',
        cstCofinsPadrao: config.cst_cofins_padrao || '07',
        autXmlCnpj: undefined,
      },
      itens: itensXml,
    });

    let xmlAssinado = assinarXmlNota(xml, infNFeId, certPem, keyPem);

    // 9. QR Code (só NFC-e).
    if (modelo === '65') {
      const { data: fiscalSecret } = await admin
        .from('store_fiscal_config_secrets')
        .select('csc_homologacao, cscid_homologacao, csc_producao, cscid_producao')
        .eq('store_id', storeId)
        .maybeSingle();
      const csc = config.ambiente === 'homologacao' ? fiscalSecret?.csc_homologacao : fiscalSecret?.csc_producao;
      const idCsc =
        config.ambiente === 'homologacao' ? fiscalSecret?.cscid_homologacao : fiscalSecret?.cscid_producao;
      if (!csc || !idCsc) throw new Error('CSC/CSCID não configurado pro ambiente atual da loja.');

      const { supl } = montarQrCode({
        chave,
        tpAmb: config.ambiente === 'homologacao' ? 2 : 1,
        idCsc,
        csc,
        urlQrCode: 'http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx',
        urlChave: 'http://hinternet.sefaz.ba.gov.br/nfce/consulta',
      });
      xmlAssinado = inserirSuplNoXmlAssinado(xmlAssinado, supl);
    }

    // 10. Transmite.
    const resposta = await transmitirNota({ modelo, ambiente: config.ambiente, xmlAssinadoComSupl: xmlAssinado, certPem: certComCadeia, keyPem });

    if (resposta.cStat !== '100') {
      await admin.from('fiscal_notas').insert({
        ...notaBase,
        status: 'rejeitada',
        chave_acesso: chave,
        numero,
        serie,
        motivo_erro: `cStat=${resposta.cStat} ${resposta.xMotivo ?? ''}`.trim(),
      });
      return NextResponse.json({ ok: false, cStat: resposta.cStat, xMotivo: resposta.xMotivo });
    }

    // 11. Autorizada — monta nfeProc, gera PDF, sobe pro storage.
    const protXml = resposta.xmlBruto.match(/<protNFe[\s\S]*?<\/protNFe>/)?.[0] ?? '';
    const nfeProc = montarNfeProc(xmlAssinado, protXml);
    const pdfBuffer = await gerarPdfNota(modelo, nfeProc);

    const xmlPath = `${storeId}/${chave}.xml`;
    const pdfPath = `${storeId}/${chave}.pdf`;
    await admin.storage.from('fiscal-documentos').upload(xmlPath, nfeProc, { contentType: 'application/xml' });
    await admin.storage.from('fiscal-documentos').upload(pdfPath, pdfBuffer, { contentType: 'application/pdf' });

    await admin.from('fiscal_notas').insert({
      ...notaBase,
      status: 'autorizada',
      chave_acesso: chave,
      numero,
      serie,
      protocolo: resposta.protocolo,
      xml_path: xmlPath,
      pdf_path: pdfPath,
    });

    return NextResponse.json({ ok: true, chave, protocolo: resposta.protocolo });
  } catch (e) {
    await admin.from('fiscal_notas').insert({
      ...notaBase,
      status: 'erro',
      motivo_erro: e instanceof Error ? e.message : 'Erro desconhecido na emissão.',
    });
    console.error('Emissão fiscal falhou:', e);
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : 'Erro desconhecido' });
  }
}
```

**Step 2: Testar manualmente com uma loja de homologação configurada**

Isso só é testável de ponta a ponta com dados reais de uma loja (certificado +
CSC + config completa) — cobrir na Task 18. Por agora, testar o **gating**
(rota devolvendo `{skipped: true}` nos casos sem config) com `curl`:
```bash
curl -X POST http://localhost:3000/api/fiscal/emitir -H 'Content-Type: application/json' -d '{"orderId": "<id de um pedido de loja sem modelo_emissao_automatica configurado>"}'
```
Esperado: `{"skipped":true,"reason":"Loja sem emissão automática configurada"}`.

**Step 3: Commit**

```bash
git add app/api/fiscal/emitir/route.ts
git commit -m "feat: rota app/api/fiscal/emitir — orquestra emissão de NFC-e/NF-e"
```

---

## Task 14: Disparo fire-and-forget no fechamento (`lib/api.ts`)

**Files:**
- Modify: `lib/api.ts` (`closeTableSession`, `closeCounterOrder`, novo `triggerEmissaoFiscal`)

**Step 1: Adicionar a função e as duas chamadas**

Logo abaixo de `triggerOrdemProducao` (`lib/api.ts:644`):

```typescript
// Emissão fiscal automática (2026-08-05) — mesmo padrão fire-and-forget de
// triggerOrdemProducao acima: nunca pode impedir o fechamento do pedido, que
// já aconteceu. Loja sem modelo_emissao_automatica configurado recebe
// { skipped: true } e nada acontece.
const triggerEmissaoFiscal = (body: { orderId?: string; tableId?: string }) => {
  fetch('/api/fiscal/emitir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((e) => console.error('Emissão fiscal automática falhou:', e));
};
```

Em `closeCounterOrder` (`lib/api.ts:632`), depois de `triggerOrdemProducao({ orderId });`:
```typescript
  triggerEmissaoFiscal({ orderId });
```

Em `closeTableSession` (`lib/api.ts:778`), depois de `triggerOrdemProducao({ tableId });`:
```typescript
    triggerEmissaoFiscal({ tableId });
```

**Step 2: Testar manualmente**

Fechar uma mesa/pedido de balcão de uma loja de teste (sem
`modelo_emissao_automatica` configurado ainda) e conferir no console do
servidor (`npm run dev`) que a chamada pra `/api/fiscal/emitir` acontece e
devolve `skipped: true` sem quebrar o fechamento.

**Step 3: Commit**

```bash
git add lib/api.ts
git commit -m "feat: dispara emissão fiscal ao fechar mesa/balcão"
```

---

## Task 15: Seletor "Modelo de emissão automática" (admin)

**Files:**
- Modify: `lib/api.ts` (`UpdateStoreFiscalConfigParams`, `updateStoreFiscalConfig`)
- Modify: `app/api/certificado/route.ts` (aceitar o campo novo no upsert de `store_fiscal_config`)
- Modify: `components/modules/StoreModule.tsx` (seção "Certificado e Configuração Fiscal")

**Step 1: Adicionar o campo no fluxo de config já existente**

Em `app/api/certificado/route.ts`, no bloco de `configFields` (perto de
`ambiente`):
```typescript
    const modeloEmissaoAutomatica = readOptionalString(form, 'modeloEmissaoAutomatica');
    if (modeloEmissaoAutomatica === 'nenhuma' || modeloEmissaoAutomatica === 'nfce' || modeloEmissaoAutomatica === 'nfe') {
      configFields.modelo_emissao_automatica = modeloEmissaoAutomatica;
    }
```

Em `StoreModule.tsx`, na seção fiscal (perto de `setFiscalCstCsosnPadrao` etc.,
`StoreModule.tsx:2528`), adicionar `useState` + carregamento a partir de
`fiscalConfig.modelo_emissao_automatica`, e no formulário um `<select>`:
```tsx
<select value={fiscalModeloEmissaoAutomatica} onChange={(e) => setFiscalModeloEmissaoAutomatica(e.target.value)}>
  <option value="nenhuma">Nenhuma (não emite automaticamente)</option>
  <option value="nfce">NFC-e (cupom fiscal)</option>
  <option value="nfe">NF-e (com destinatário)</option>
</select>
```
Incluir `modeloEmissaoAutomatica` no `FormData` enviado pro `/api/certificado`
junto com o resto dos campos fiscais (mesmo padrão dos outros `set...`/envio
já existentes nesse formulário).

**Step 2: Testar manualmente**

Selecionar "NFC-e" numa loja de teste, salvar, recarregar a página e confirmar
que o valor persiste (mesmo teste que qualquer outro campo dessa seção já
recebe).

**Step 3: Commit**

```bash
git add app/api/certificado/route.ts components/modules/StoreModule.tsx lib/api.ts
git commit -m "feat: seletor de modelo de emissão automática na config fiscal"
```

---

## Task 16: Aba "Notas Fiscais" no admin (lista, download, reemissão)

**Files:**
- Modify: `lib/api.ts` (novo `fetchFiscalNotas`, `reemitirFiscalNota`, `fetchFiscalNotaPdfUrl`)
- Create: `app/api/fiscal/pdf-url/route.ts` (signed URL sob demanda)
- Modify: `components/modules/StoreModule.tsx` (nova aba)

**Step 1: Rota de signed URL**

```typescript
// app/api/fiscal/pdf-url/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  const { pdfPath } = await req.json();
  if (typeof pdfPath !== 'string') {
    return NextResponse.json({ success: false, message: 'pdfPath inválido.' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.storage.from('fiscal-documentos').createSignedUrl(pdfPath, 60);
  if (error || !data) {
    return NextResponse.json({ success: false, message: error?.message || 'Falha ao gerar URL.' }, { status: 500 });
  }
  return NextResponse.json({ success: true, url: data.signedUrl });
}
```

**Step 2: Funções em `lib/api.ts`**

```typescript
export const fetchFiscalNotas = async (storeId: string) => {
  const { data, error } = await supabase
    .from('fiscal_notas')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
};

export const fetchFiscalNotaPdfUrl = async (pdfPath: string): Promise<string> => {
  const res = await fetch('/api/fiscal/pdf-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfPath }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message);
  return json.url;
};

// Reemissão manual: mesma rota de emissão, chamada direto (não
// fire-and-forget) pra dar feedback síncrono ao lojista na tela de retry.
export const reemitirFiscalNota = async (params: { orderId?: string; tableId?: string }) => {
  const res = await fetch('/api/fiscal/emitir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
};
```

**Step 3: Nova aba no `StoreModule.tsx`**

Seguir o padrão de aba já usado pras outras seções do admin (`grep -n
"'certificado'\|activeTab ===" components/modules/StoreModule.tsx` pra achar
como as abas existentes trocam de conteúdo). Renderizar uma tabela com
`data | valor | modelo | status (badge colorido) | chave` + botão "Baixar PDF"
(chama `fetchFiscalNotaPdfUrl` e abre em nova aba) + botão "Reemitir" nas
linhas com `status IN ('erro','pendente')` (chama `reemitirFiscalNota` com o
`order_id`/`table_id` daquela linha).

**Step 4: Testar manualmente**

Com pelo menos uma nota `erro` (gerada propositalmente, ex. produto sem NCM
numa venda de teste), confirmar que aparece na lista e que "Reemitir" dispara
de novo.

**Step 5: Commit**

```bash
git add app/api/fiscal/pdf-url/route.ts lib/api.ts components/modules/StoreModule.tsx
git commit -m "feat: aba Notas Fiscais no admin — lista, download de PDF e reemissão"
```

---

## Task 17: Campo CPF/CNPJ do destinatário (só quando `modelo_emissao_automatica = 'nfe'`)

**Files:**
- Modify: `components/modules/StoreModule.tsx` (fluxo de fechar mesa — `closeTableSession`, linhas ~1364/1398 — e fechar balcão — `closeCounterOrder`, linha ~2230)
- Modify: `lib/api.ts` (`closeTableSession`/`closeCounterOrder` recebem `destinatario?`)
- Modify: `app/api/fiscal/emitir/route.ts` (aceita `destinatario` no body, passa pro `montarXmlNota`)

**Step 1: Propagar o campo opcional**

`closeTableSession`/`closeCounterOrder` em `lib/api.ts` ganham um parâmetro
opcional `destinatario?: { cpfCnpj: string; nome: string }`, repassado tanto
pra RPC de fechamento quanto (via `triggerEmissaoFiscal`) pro body de
`/api/fiscal/emitir`. A rota (Task 13) passa a ler `body.destinatario` e usar
no `montarXmlNota` quando presente.

**Step 2: UI condicional**

No modal/tela de fechar mesa e no fluxo de fechar balcão em `StoreModule.tsx`,
antes de chamar `closeTableSession`/`closeCounterOrder`, checar
`fiscalConfig?.modelo_emissao_automatica === 'nfe'` (já carregado na Task 15)
e, se for o caso, mostrar dois campos opcionais (CPF/CNPJ + nome) acima do
botão de confirmar. Vazio é permitido — a nota cai em `pendente` com motivo
"falta documento do destinatário" (comportamento já implementado na Task 13
via `if (modelo === '55' && !destinatario)`, que hoje lança erro; ajustar pra
gravar como `pendente` em vez de `erro` genérico quando o motivo for
especificamente falta de destinatário).

**Step 3: Testar manualmente**

Configurar uma loja de teste com `modelo_emissao_automatica = 'nfe'`, fechar
uma mesa sem preencher CPF/CNPJ — confirmar que a nota cai como `pendente` na
aba de Notas Fiscais com o motivo certo, e que preencher o documento e clicar
"Reemitir" funciona.

**Step 4: Commit**

```bash
git add lib/api.ts components/modules/StoreModule.tsx app/api/fiscal/emitir/route.ts
git commit -m "feat: captura opcional de CPF/CNPJ do destinatário pra emissão de NF-e"
```

---

## Task 18: Validação ponta a ponta contra a SEFAZ de homologação

**Não é um passo de código — é o mesmo processo manual já usado em todas as
validações anteriores deste projeto (06/07 a 04/08/2026), agora passando pelo
app de verdade em vez de um script standalone.**

**Pré-requisitos:**
- Uma loja de teste real cadastrada no `ntb-vendas` com certificado, CSC de
  homologação, config fiscal completa e `ambiente = 'homologacao'` (nunca
  mudar isso durante o teste).
- Pelo menos um produto de teste com NCM preenchido.
- `modelo_emissao_automatica = 'nfce'` primeiro (mais simples, sem
  destinatário); repetir depois com `'nfe'`.

**Passos:**
1. Abrir uma mesa, lançar um pedido de teste com o produto de NCM preenchido.
2. Fechar a mesa pela UI normal do lojista.
3. Conferir no console do servidor (`npm run dev`, ou logs de produção se
   estiver rodando lá) que `/api/fiscal/emitir` foi chamada e não lançou
   exceção não tratada.
4. Conferir na aba "Notas Fiscais" do admin: linha nova com `status =
   'autorizada'`, `chave_acesso` preenchida, botão "Baixar PDF" funcionando
   (abre um PDF válido).
5. Confirmar a chave de acesso por consulta cruzada (mesmo processo já usado
   em 2026-08-04): rodar `NfeConsultaProtocolo4` no SVRS (pra NFC-e) ou o
   endpoint de consulta da BA (pra NF-e) com a chave gerada, e conferir
   `cStat=100`.
6. Repetir com `modelo_emissao_automatica = 'nfe'`: fechar uma mesa
   preenchendo CPF/CNPJ do destinatário, confirmar autorização; depois fechar
   uma segunda mesa **sem** preencher, confirmar que cai como `pendente` (não
   `erro` genérico) e que "Reemitir" com o documento preenchido depois
   funciona.
7. Se qualquer `cStat` vier diferente de 100, comparar a rejeição com o
   histórico já documentado em `AGENTS.md` (schema/ordem de campos, série
   fora da faixa esperada pela BA, `autXML` faltando, etc.) antes de assumir
   que é um bug novo — muitas dessas rejeições já têm causa e correção
   conhecidas.

**Depois de confirmado:**
- Registrar o resultado (data, `cStat`, chave de exemplo — sem CNPJ/CPF real
  de cliente, mesmo cuidado de sempre) numa atualização nova em `AGENTS.md`,
  seguindo o mesmo formato das atualizações anteriores dessa seção.
- **Não emitir em produção** como parte desta validação — isso só acontece
  depois, loja a loja, com confirmação explícita do usuário no momento (regra
  crítica já em vigor no projeto).

```bash
git add AGENTS.md
git commit -m "docs: emissão fiscal automática validada ponta a ponta em homologação"
```
