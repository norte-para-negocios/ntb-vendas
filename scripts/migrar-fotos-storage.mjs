// Copia os arquivos reais do Storage do Supabase cloud pro storage-vendas
// no Contabo (Fase 2 da migração). Roda no SERVIDOR (via SSH), não local
// -- o `.env.local` deste repo, quando rodando no Contabo em
// /opt/ntb-vendas, já aponta pro backend novo desde a Fase 1.
// Uso (no Contabo): cd /opt/ntb-vendas && node scripts/migrar-fotos-storage.mjs
import fs from 'node:fs'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const NEW_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const CLOUD_URL = 'https://giiwtnddasminjxweohr.supabase.co'
const CLOUD_ANON_KEY = env.NTB_VENDAS_CLOUD_ANON_KEY
const CLOUD_SERVICE_KEY = env.NTB_VENDAS_CLOUD_SERVICE_KEY

const PRIVATE_BUCKETS = new Set(['store-certificates', 'fiscal-documentos'])
const BUCKETS = ['product-images', 'store-logos', 'store-certificates', 'fiscal-documentos']

async function listarPasta(bucket, prefix) {
  const res = await fetch(`${CLOUD_URL}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: { apikey: CLOUD_SERVICE_KEY, Authorization: `Bearer ${CLOUD_SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 1000, prefix }),
  })
  if (!res.ok) throw new Error(`Falha ao listar ${bucket}/${prefix}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function listarObjetosCloud() {
  // Lista via Storage API do próprio cloud. Achado real #1: storage.objects
  // tem RLS habilitada com ZERO policies no projeto cloud -- o flag
  // "público" de um bucket só libera o endpoint de DOWNLOAD direto
  // (/object/public/...), não a listagem (/object/list/...), que exige
  // SELECT via RLS -- por isso a listagem sempre usa a service key,
  // mesmo pros buckets públicos. Achado real #2: store-certificates/
  // fiscal-documentos guardam arquivo dentro de subpasta por loja
  // (ex: "<store_id>/certificado.pfx") -- a listagem na raiz só devolve
  // a PASTA (item.id === null, "arquivo" nenhum), por isso a listagem
  // precisa ser recursiva: entrar em toda pasta encontrada.
  const objetos = []
  for (const bucket of BUCKETS) {
    const privado = PRIVATE_BUCKETS.has(bucket)
    const raiz = await listarPasta(bucket, '')
    for (const item of raiz) {
      if (item.id) {
        objetos.push({ bucket, name: item.name, privado })
      } else {
        const filhos = await listarPasta(bucket, `${item.name}/`)
        for (const filho of filhos) {
          if (filho.id) objetos.push({ bucket, name: `${item.name}/${filho.name}`, privado })
        }
      }
    }
  }
  return objetos
}

async function baixar(bucket, name, privado) {
  const url = privado
    ? `${CLOUD_URL}/storage/v1/object/${bucket}/${name}`
    : `${CLOUD_URL}/storage/v1/object/public/${bucket}/${name}`
  const headers = privado
    ? { apikey: CLOUD_SERVICE_KEY, Authorization: `Bearer ${CLOUD_SERVICE_KEY}` }
    : {}
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`Falha ao baixar ${bucket}/${name}: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function subir(bucket, name, buffer) {
  const res = await fetch(`${NEW_URL}/storage/v1/object/${bucket}/${name}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: buffer,
  })
  if (!res.ok) throw new Error(`Falha ao subir ${bucket}/${name}: ${res.status} ${await res.text()}`)
}

async function main() {
  const objetos = await listarObjetosCloud()
  console.log(`${objetos.length} objetos encontrados no cloud`)
  for (const obj of objetos) {
    const buffer = await baixar(obj.bucket, obj.name, obj.privado)
    await subir(obj.bucket, obj.name, buffer)
    console.log(`OK: ${obj.bucket}/${obj.name} (${buffer.length} bytes)`)
  }
  console.log('Concluído.')
}

main().catch(e => { console.error(e); process.exit(1) })
