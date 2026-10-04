// Utilitários compartilhados do portão de deploy (scripts/e2e). Sem dependência além de node, supabase-js e playwright-core.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const ZZ = 'f33b4310-ff0a-487c-a3b1-62acd0a58850';
export const DONANA = '88cbe990-1542-4f6f-b2a8-c0d3db22e10a';
export const LOJAS_PERMITIDAS = new Set([ZZ, DONANA]);
export const SERTAO_ID = '4f8a9e1a-6c3d-4b2e-9f7a-8e5c1d2b3a90';
export const SSH_KEY = process.env.PORTAO_SSH_KEY || `${process.env.HOME}/.ssh/notebook_contabo_key`;
export const SSH_HOST = process.env.PORTAO_SSH_HOST || 'root@185.193.66.240';
export const PLAYWRIGHT_CORE = process.env.PLAYWRIGHT_CORE || '/Users/joaquimsalles/Projects/Depsys/node_modules/playwright-core';

export function carregarEnv() {
  const env = {};
  for (const arq of ['.env.local']) {
    const p = path.join(RAIZ, arq);
    if (!fs.existsSync(p)) continue;
    for (const linha of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

export async function carregarPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require(PLAYWRIGHT_CORE); } catch { /* tenta o import ESM */ }
  const mod = await import(pathToFileURL(path.join(PLAYWRIGHT_CORE, 'index.js')).href);
  return mod.default ?? mod;
}

// Senha aleatória (nunca impressa). Letras+dígitos, 14 caracteres, única o bastante para a regra de senha única da loja.
export const senhaAleatoria = () => 'Q' + crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x') + '7';

// psql no Postgres de PRODUÇÃO do Contabo (banco ntb_vendas), via ssh. O SQL vai por stdin (nunca aparece em ps nem em log).
export function psql(sql, { banco = 'ntb_vendas', comoPostgres = false } = {}) {
  const remoto = comoPostgres
    ? `su - postgres -c "psql -d ${banco} -v ON_ERROR_STOP=1 -At -F '|'"`
    : `docker exec -i supabase-db psql -U supabase_admin -d ${banco} -v ON_ERROR_STOP=1 -At -F '|'`;
  const r = spawnSync('ssh', ['-i', SSH_KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', SSH_HOST, remoto], { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`psql falhou (${banco}): ${(r.stderr || '').trim().slice(0, 400)}`);
  return r.stdout;
}

// Devolve linhas como objetos (via jsonb_agg, uma linha só).
export function consulta(sql, opts) {
  const out = psql(`select coalesce(jsonb_agg(t), '[]'::jsonb)::text from (${sql.replace(/;\s*$/, '')}) t;`, opts).trim();
  const ultima = out.split('\n').filter(Boolean).pop() || '[]';
  return JSON.parse(ultima);
}
export const esc = (s) => String(s).replace(/'/g, "''");
