// rodar com: npx tsx scripts/testes/emissaoFiscalSemDuplicar.test.ts
// 05/10/2026: duas chamadas simultâneas da MESMA venda emitiam duas NFC-e (notas 140/141). A rota agora serializa por venda.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync('app/api/fiscal/emitir/route.ts', 'utf8');
assert.match(fonte, /const emissoesEmAndamento = new Map/);
assert.match(fonte, /await anterior;/);
assert.match(fonte, /finally \{[^}]*liberar_trava_emissao[\s\S]*?\n\s*liberar\(\);/);

// Mesma lógica da trava, isolada: 2 chamadas da mesma chave nunca rodam ao mesmo tempo; chaves diferentes seguem em paralelo.
const mapa = new Map<string, Promise<unknown>>();
async function comTrava<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  const anterior = mapa.get(chave) ?? Promise.resolve();
  let liberar: () => void = () => {};
  const minha = new Promise<void>((r) => { liberar = r; });
  const cauda = anterior.then(() => minha);
  mapa.set(chave, cauda);
  await anterior;
  try { return await fn(); } finally { liberar(); if (mapa.get(chave) === cauda) mapa.delete(chave); }
}
let ativos = 0, maximo = 0, emitidas = 0;
const jaEmitida = new Set<string>();
const emitir = (chave: string) => comTrava(chave, async () => {
  ativos++; maximo = Math.max(maximo, ativos);
  const existe = jaEmitida.has(chave);          // a "guarda de idempotência"
  await new Promise((r) => setTimeout(r, 30));   // a ida à SEFAZ
  if (!existe) { jaEmitida.add(chave); emitidas++; }
  ativos--;
});
(async () => {
await Promise.all([emitir('mesa7'), emitir('mesa7'), emitir('mesa7')]);
assert.equal(emitidas, 1, 'a mesma venda emite uma nota só');
assert.equal(maximo, 1);
await Promise.all([emitir('a'), emitir('b')]);
assert.equal(emitidas, 3, 'vendas diferentes não se bloqueiam');
assert.equal(mapa.size, 0, 'não vaza memória');
console.log('emissaoFiscalSemDuplicar: ok');
})().catch((e) => { console.error(e); process.exit(1); });
