// Importa os dados reais (7 lojas, usuarios, categorias, produtos, mesas,
// pedidos e itens) puxados do projeto Supabase original para o projeto novo.
// Preserva os UUIDs originais para manter as referencias entre tabelas.
// Uso: node scripts/import-dados-originais.mjs
import fs from 'node:fs'
import pg from 'pg'

const PROJ = process.cwd()
const DATA_DIR = 'C:\\Users\\media\\AppData\\Local\\Temp\\claude\\C--Users-media\\94a24849-9634-4532-ac51-066c9844d3b0\\scratchpad\\original-data'

const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
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

const load = (name) => JSON.parse(fs.readFileSync(`${DATA_DIR}/${name}.json`, 'utf-8'))

async function insertRows(table, rows, columns) {
  if (rows.length === 0) return
  let inserted = 0
  for (const row of rows) {
    const values = columns.map(c => {
      const v = row[c]
      if (v !== null && typeof v === 'object') return JSON.stringify(v)
      return v
    })
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
    const quotedCols = columns.map(c => `"${c}"`).join(', ')
    const sql = `insert into ${table} (${quotedCols}) values (${placeholders}) on conflict (id) do nothing`
    await client.query(sql, values)
    inserted++
  }
  console.log(`${table}: ${inserted} linha(s) inserida(s)`)
}

async function main() {
  await client.connect()
  await client.query('SET default_transaction_read_only = off')

  // 1. Remove a loja fake "Bistrô Demo" (slug bistro) que criamos no seed de
  //    demonstração — o slug é UNIQUE e vai colidir com a loja real do mesmo
  //    slug. Cascade remove categorias/produtos/mesas/pedidos ligados a ela.
  //    Protegido por id: nunca apaga a loja real (mesmo se rodar de novo).
  const REAL_BISTRO_ID = '3858c22f-3a39-48b0-8928-b73674c47ed9'
  const del = await client.query(`delete from stores where slug = 'bistro' and id != $1 returning id`, [REAL_BISTRO_ID])
  console.log(`Loja fake 'bistro' removida: ${del.rowCount} linha(s)`)

  const stores = load('stores')
  await insertRows('stores', stores, [
    'id', 'name', 'slug', 'logo_url', 'cnpj', 'is_active', 'contract_type',
    'contract_period_months', 'activation_date', 'config', 'created_at',
  ])

  const storeUsers = load('store_users')
  await insertRows('store_users', storeUsers, [
    'id', 'store_id', 'name', 'email', 'password', 'role',
    'must_change_password', 'permissions', 'created_at',
  ])

  const categories = load('categories')
  await insertRows('categories', categories, ['id', 'store_id', 'name', 'order', 'icon'])

  const products = load('products')
  await insertRows('products', products, [
    'id', 'category_id', 'store_id', 'name', 'description', 'price',
    'image_url', 'available', 'prep_time_minutes', 'order', 'destination',
  ])

  const tables = load('tables').map(t => ({
    ...t,
    guest_count: t.guest_count ?? 0,
    waiter_requested: t.waiter_requested ?? false,
    service_fee_removed: t.service_fee_removed ?? false,
  }))
  await insertRows('tables', tables, [
    'id', 'store_id', 'number', 'pin', 'status', 'current_host_name',
    'guest_count', 'waiter_requested', 'service_fee_removed',
  ])

  const orders = load('orders')
  await insertRows('orders', orders, [
    'id', 'table_id', 'store_id', 'status', 'order_type', 'total',
    'customer_name', 'payment_method', 'payment_details', 'created_at', 'updated_at',
  ])

  const orderItems = load('order_items')
  await insertRows('order_items', orderItems, [
    'id', 'order_id', 'product_id', 'quantity', 'status', 'notes',
    'price_at_time', 'created_at',
  ])

  await client.end()
  console.log('\nImportação concluída.')
}

main().catch(async (e) => {
  console.error('ERRO:', e)
  try { await client.end() } catch {}
  process.exit(1)
})
