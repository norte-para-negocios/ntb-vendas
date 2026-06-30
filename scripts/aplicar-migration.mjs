// Aplica uma migration achando uma conexao Postgres que funcione nesta rede.
// O "db direct" e IPv6-only; varre os poolers (aws-0 e aws-1) por regiao e aplica
// o SQL na primeira que conectar. Uso: node scripts/aplicar-migration.mjs 001_schema_inicial.sql
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

const arquivo = process.argv[2]
if (!arquivo) { console.error('uso: node scripts/aplicar-migration.mjs <arquivo.sql>'); process.exit(1) }
const sql = fs.readFileSync(`${PROJ}/supabase/migrations/${arquivo}`, 'utf8')
console.log('ref:', ref, '| migration:', arquivo)

const prefixos = ['aws-1', 'aws-0']
const regioes = ['sa-east-1', 'us-east-1', 'us-east-2', 'us-west-1', 'eu-central-1', 'eu-west-1', 'ap-southeast-1', 'ca-central-1']

for (const pre of prefixos) {
  for (const reg of regioes) {
    const host = `${pre}-${reg}.pooler.supabase.com`
    const client = new pg.Client({
      host,
      port: 5432,
      user: `postgres.${ref}`,
      password: senha,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 7000,
    })
    try {
      await client.connect()
    } catch (e) {
      console.log(`  ${host}: ${e.code || ''} ${(e.message || '').slice(0, 70)}`)
      try { await client.end() } catch {}
      continue
    }
    // conectou: salva o host e aplica. Erro daqui em diante e da query (dados/SQL),
    // nao de conexao -> reportar e parar, nao tentar outras regioes.
    console.log(`CONECTOU em ${host}`)
    fs.writeFileSync(`${PROJ}/scripts/.pooler-host`, `${host}:5432`)
    try {
      await client.query('SET default_transaction_read_only = off')
      await client.query(sql)
      console.log('MIGRATION APLICADA.')
      await client.end()
      process.exit(0)
    } catch (e) {
      console.log(`ERRO na query: ${e.code || ''} ${(e.message || '').slice(0, 200)}`)
      try { await client.end() } catch {}
      process.exit(1)
    }
  }
}
console.log('NENHUM pooler conectou')
process.exit(1)
