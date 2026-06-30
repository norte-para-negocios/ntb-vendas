// Executa SQL no Postgres do Supabase via o pooler que funciona nesta rede.
// O "db direct" e IPv6-only; usa o pooler salvo em .pooler-host (gerado pelo
// aplicar-migration) ou cai no aws-1-sa-east-1. SQL vem dos argumentos.
// Uso: node scripts/db.mjs "select id, name from stores order by id"
import fs from 'node:fs'
import pg from 'pg'

const PROJ = process.cwd()
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

const sql = process.argv.slice(2).join(' ')
if (!sql) { console.error('uso: node scripts/db.mjs "<SQL>"'); process.exit(1) }

const client = new pg.Client({
  host, port, user: `postgres.${ref}`, password: senha,
  database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000,
})
await client.connect()
try { await client.query('SET default_transaction_read_only = off') } catch {}
const r = await client.query(sql)
if (r.rows?.length) console.log(JSON.stringify(r.rows, null, 2))
else console.log(`OK (${r.rowCount} linha(s) afetada(s))`)
await client.end()
