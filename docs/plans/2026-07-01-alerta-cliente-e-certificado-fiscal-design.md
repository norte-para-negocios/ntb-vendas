# Alerta ativo no cliente + espaço de certificado digital fiscal

Data: 2026-07-01
Status: aprovado, aguardando plano de implementação

## Contexto

Duas entradas do backlog documentado em `AGENTS.md` ("Backlog / Próximos
passos"):

1. Alerta ativo na tela do cliente quando um prato entra em preparo ou fica
   pronto (hoje só existe um badge passivo).
2. Espaço para a loja cadastrar o certificado digital (fase de armazenamento
   apenas — a emissão de NFC-e/SEFAZ em si é um trabalho futuro separado).

## Feature 1 — Alerta ativo no `OrderTracker`

**Local:** `OrderTracker` em `components/modules/ClientModule.tsx`. Estende a
lógica que já existe (Realtime channel de `order_items` + `derivedStatus`
agregado), não cria componente novo.

**Comportamento — híbrido, escopo "só com a tela aberta":**
- Por item: a cada evento Realtime em `order_items`, comparar contra um
  snapshot anterior (`useRef`) e disparar `toast.info`/`toast.success`
  (silencioso) quando um item individual vira `preparing` ou `ready`.
- Agregado: quando o `derivedStatus` do pedido (mesma lógica já usada pro
  banner "PRONTO!" e pra timeline) transiciona para `PREPARING` ou `READY`,
  disparar som (Web Audio API) + `navigator.vibrate` além do toast.
- Nenhum alerta no carregamento inicial — só em transições reais depois do
  primeiro fetch (guardar uma flag de "já carregou uma vez" antes de começar
  a comparar).

**Som:** novo `lib/audioAlert.ts`, oscillator da Web Audio API — sem arquivo
de áudio. Dois tons distintos (preparando = suave, pronto = duplo-beep mais
chamativo). `navigator.vibrate([...])` como bônus condicional, com
feature-detection (`'vibrate' in navigator`) — no-op silencioso em iOS Safari,
que não suporta a API.

**Fora de escopo (documentado, não implementado agora):** Web Push /
Service Worker para alertar com o app fechado ou tela bloqueada — exigiria
infraestrutura de push (VAPID keys, backend pra disparar, já que o projeto
não tem API routes) e é um projeto à parte.

## Feature 2 — Espaço do certificado digital (Master Admin)

**Local:** nova seção "Certificado Digital (fiscal)" dentro do modal de
editar loja já existente em `components/modules/AdminModule.tsx` (mesmo
lugar que já tem CNPJ, logo, tipo de contrato). Só aparece com uma loja já
existente sendo editada (precisa de `store_id`).

**Modelo de dados (`supabase/migrations/006_fiscal_certificado.sql`):**

- Bucket de Storage `store-certificates`, **privado** (`public = false`).
  Policy de **INSERT apenas** pra `anon` em `storage.objects` filtrado por
  `bucket_id = 'store-certificates'` — sem nenhuma policy de `SELECT`. O
  admin consegue subir o `.pfx`, mas ninguém consegue baixar de volta usando
  a chave anônima. Caminho determinístico `${storeId}/certificado.pfx`
  (upload com `upsert: true` substitui o anterior, sem arquivo órfão).

- Tabela `store_fiscal_certificates` — metadados **legíveis**
  (`original_filename`, `uploaded_at`, `expires_at`, `store_id` único). RLS
  `allow_all_anon` normal, igual ao resto do banco — não é dado sigiloso, e
  a UI do Admin precisa listar/mostrar isso.

- Tabela `store_fiscal_certificate_secrets` — só a senha do `.pfx`
  (`store_id` único, `password text`). RLS com policy de **INSERT/UPDATE
  apenas, sem nenhuma policy de SELECT** — genuinamente write-only: o admin
  digita e salva, mas nenhuma leitura via anon key retorna a linha depois
  (RLS nega por padrão quando não existe policy de SELECT que bata). Um
  processo futuro com service role (quando a emissão de NFC-e for
  implementada) vai conseguir ler.

Esse padrão (write-only via ausência de policy de SELECT) generaliza o
mesmo princípio já usado no PIN de mesa (`open_table_session`,
`003_secure_table_pin.sql`) — vale documentar no `AGENTS.md` como o padrão
oficial deste projeto pra qualquer credencial sensível futura, já que o
app não tem Supabase Auth nem API routes pra fazer isso de outro jeito.

**UI do form:**
- Badge de status: sem certificado / válido até DD/MM/AAAA (verde) / vence
  em breve (âmbar, <30 dias) / vencido (vermelho).
- Input de arquivo (`.pfx`/`.p12`).
- Campo de data de validade.
- Campo de senha (`type="password"`), sempre em branco ao reabrir o form —
  "deixe em branco pra manter a senha atual" — porque não dá pra pré-popular
  (é write-only por design).

**Camada de dados (`lib/api.ts`):** novas funções `uploadStoreCertificate`,
`saveStoreCertificateMetadata`, `saveStoreCertificateSecret`,
`fetchStoreCertificateStatus`.

**Tipos (`types/index.ts`):** nova interface `StoreFiscalCertificate`
(`store_id`, `original_filename`, `uploaded_at`, `expires_at`).

## Testes

Projeto não tem suite automatizada (só `lint`/`build`, ver `package.json`).
Validação via `npm run build` (convenção já documentada no AGENTS.md) +
teste manual no browser: upload de certificado na loja demo, verificar
badge de status, verificar que o alerta dispara ao mudar status de um item
de pedido de teste.

## Erros e casos de borda

- Upload de certificado falha (rede, arquivo grande demais): `toast.error`,
  não perde os outros campos do form da loja.
- Realtime desconecta e reconecta no meio do acompanhamento do cliente: o
  fetch inicial ao reconectar não deve dis­parar alertas retroativos — só
  comparar contra o snapshot anterior, nunca contra "vazio".
- `navigator.vibrate` ausente (iOS Safari): checar existência antes de
  chamar, sem lançar erro.
- AudioContext bloqueado por autoplay policy: tentar tocar e ignorar
  silenciosamente (`catch`) se o navegador recusar — o toast visual continua
  funcionando de qualquer forma.
