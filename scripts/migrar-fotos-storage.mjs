// Baixa as fotos que ainda dependem do Storage do projeto Supabase original
// e sobe no Storage do projeto novo, atualizando os registros no banco.
// Uso: node scripts/migrar-fotos-storage.mjs
import fs from 'node:fs'
import pg from 'pg'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const NEW_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

const ITEMS = [
  { table: 'products', column: 'image_url', id: '064b9bd6-61cd-46e9-a787-126a2cd9e386', name: 'Coxinha', bucket: 'product-images', file: '1770685780010-7xpfe1p45rg.jpg' },
  { table: 'products', column: 'image_url', id: '103a653c-e5d1-49b5-b118-6f03c903eda5', name: 'Sushi', bucket: 'product-images', file: '1770737075151-pr4vtwsfbrd.avif' },
  { table: 'products', column: 'image_url', id: '1ccb83f0-e86b-4147-a36b-2858242b6d69', name: 'Sashimi', bucket: 'product-images', file: '1770736943279-uv6r661i4ul.jpg' },
  { table: 'products', column: 'image_url', id: '25495e2a-e235-4a39-bd84-f9b502baccfe', name: 'Coca-Cola', bucket: 'product-images', file: '1770736115861-t2v8if4ss6l.jpg' },
  { table: 'products', column: 'image_url', id: '48813b00-19c6-4997-aabe-d097c1ee3147', name: 'Salada Massao', bucket: 'product-images', file: '1770736012244-8yfm3m23z1x.jpg' },
  { table: 'products', column: 'image_url', id: '6df4d14c-95c0-4cab-947c-7a57d321b640', name: 'Guioza', bucket: 'product-images', file: '1770736201818-hm0ss59v39j.jpg' },
  { table: 'products', column: 'image_url', id: '70ea2ea5-409b-4fa3-8fb0-73cae3987fd1', name: 'Misso', bucket: 'product-images', file: '1770736430224-i9avkzr55jr.jpg' },
  { table: 'products', column: 'image_url', id: '8b1c93aa-22eb-4407-a7b5-a75bdb162c28', name: 'Sorvete', bucket: 'product-images', file: '1770737171135-41zrdle6adc.jpg' },
  { table: 'products', column: 'image_url', id: '9a1c0835-9ca0-4867-8822-ce327e667664', name: 'Cerveja Amstel', bucket: 'product-images', file: '1770736361602-hknf6czxv6q.webp' },
  { table: 'products', column: 'image_url', id: 'ae7e46e0-c415-44d4-946b-bbf2c9f84c26', name: 'Mousse de Chocolate', bucket: 'product-images', file: '1770737223632-b5k9cpfbul.jfif' },
  { table: 'products', column: 'image_url', id: 'b03da782-5210-4106-92c0-ad676a315f4d', name: 'Salmao no Papelote', bucket: 'product-images', file: '1770735870195-kiii7qrpep.jpg' },
  { table: 'products', column: 'image_url', id: 'b60764c5-de8f-49bd-bacb-a12e2e310045', name: 'Suco de Laranja', bucket: 'product-images', file: '1770736257289-2dcr28cng0h.jpg' },
  { table: 'products', column: 'image_url', id: 'c958cb13-44a3-48a5-bf88-65ee5c94d34e', name: 'Temaki', bucket: 'product-images', file: '1770736498824-t4u7ygyzwcg.jpg' },
  { table: 'stores', column: 'logo_url', id: '66dcff7a-0d0b-4b15-8fb1-a2145e47cfe3', name: 'Japanese (logo)', bucket: 'store-logos', file: '1770737435519-y3ew4ghon8i.png' },
]

const ORIGINAL_URL = 'https://oozoplkxjeygenyayaqv.supabase.co'

const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  avif: 'image/avif', jfif: 'image/jpeg', gif: 'image/gif',
}

async function ensureBucket(name) {
  const res = await fetch(`${NEW_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: name, name, public: true }),
  })
  const body = await res.json()
  if (res.ok) console.log(`Bucket '${name}' criado.`)
  else if (body.message?.includes('already exists') || body.error === 'Duplicate') console.log(`Bucket '${name}' já existe.`)
  else console.log(`Bucket '${name}':`, body)
}

async function migrarFoto(item) {
  const originalUrl = `${ORIGINAL_URL}/storage/v1/object/public/${item.bucket}/${item.file}`
  const res = await fetch(originalUrl)
  if (!res.ok) { console.log(`FALHOU download ${item.name}: ${res.status}`); return null }
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = item.file.split('.').pop().toLowerCase()
  const mime = EXT_MIME[ext] || 'application/octet-stream'

  const uploadRes = await fetch(`${NEW_URL}/storage/v1/object/${item.bucket}/${item.file}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': mime,
      'x-upsert': 'true',
    },
    body: buf,
  })
  if (!uploadRes.ok) {
    const errBody = await uploadRes.text()
    console.log(`FALHOU upload ${item.name}: ${uploadRes.status} ${errBody}`)
    return null
  }
  const newUrl = `${NEW_URL}/storage/v1/object/public/${item.bucket}/${item.file}`
  console.log(`OK ${item.name} (${(buf.length / 1024).toFixed(0)} KB)`)
  return newUrl
}

async function main() {
  await ensureBucket('product-images')
  await ensureBucket('store-logos')

  const u = new URL(env.SUPABASE_DB_URL)
  const senha = decodeURIComponent(u.password)
  const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')
  let host = 'aws-1-sa-east-1.pooler.supabase.com'
  let port = 5432
  try {
    const saved = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim()
    const [h, p] = saved.split(':')
    if (h) host = h
    if (p) port = Number(p)
  } catch {}
  const client = new pg.Client({
    host, port, user: `postgres.${ref}`, password: senha,
    database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000,
  })
  await client.connect()
  await client.query('SET default_transaction_read_only = off')

  for (const item of ITEMS) {
    const newUrl = await migrarFoto(item)
    if (!newUrl) continue
    await client.query(`update ${item.table} set ${item.column} = $1 where id = $2`, [newUrl, item.id])
  }

  await client.end()
  console.log('\nMigração de fotos concluída.')
}

main().catch(e => { console.error(e); process.exit(1) })
