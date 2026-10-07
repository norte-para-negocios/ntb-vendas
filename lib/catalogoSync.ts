// lib/catalogoSync.ts — sincronização automática do catálogo com o Norte Estoque (lojas stock_mode='proprio').
// Modelo e regras: ntb-estoque/docs/superpowers/specs/2026-10-06-sync-catalogo-design.md
//   - gatilhos do banco (migration 170) gravam toda mudança no `sync_estoque_outbox`; aqui o outbox é entregue ao Estoque;
//   - o que chega do Estoque entra por `aplicar_catalogo_estoque` (rota /api/integracao/catalogo), sem eco;
//   - preço de venda: o Vendas manda; código/unidade/tipo/NCM: o Estoque manda; nome/grupo: vence o updated_at mais novo.
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const MAX_TENTATIVAS = 8;
const TIMEOUT_MS = 20_000;
let cicloEmExecucao = false;

type Admin = ReturnType<typeof getSupabaseAdmin>;
type Secret = { store_id: string; ntb_estoque_url: string; ntb_estoque_api_key: string };
type RespostaEstoque = {
  ok?: boolean; error?: string;
  grupos?: { vendas_ref: string; grupo_id: number }[];
  produtos?: { vendas_ref: string; codigo: string; criado?: boolean }[];
};

async function chamar(url: string, key: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  } finally {
    clearTimeout(t);
  }
}

function proxima(tentativas: number): string {
  return new Date(Date.now() + Math.min(60, 2 ** Math.max(1, tentativas)) * 60_000).toISOString();
}

/** Lojas em estoque próprio sem ligação: pede ao Estoque (rota bootstrap, idempotente por CNPJ) a loja correspondente. */
export async function vincularLojasPendentes(admin: Admin): Promise<number> {
  const segredo = process.env.CROSS_SYSTEM_BOOTSTRAP_KEY;
  const base = process.env.NTB_ESTOQUE_INTERNAL_URL?.replace(/\/$/, '');
  if (!segredo || !base) return 0;
  const { data: lojas } = await admin.from('stores').select('id, name, cnpj').eq('stock_mode', 'proprio').eq('is_active', true);
  if (!lojas?.length) return 0;
  const { data: ligadas } = await admin.from('store_ntb_estoque_secrets').select('store_id').in('store_id', lojas.map((l) => l.id));
  const jaLigada = new Set((ligadas ?? []).map((l) => l.store_id as string));
  let n = 0;
  for (const loja of lojas.filter((l) => !jaLigada.has(l.id as string))) {
    try {
      const r = await chamar(`${base}/api/integracao/lojas`, segredo, { nome: loja.name, cnpj: loja.cnpj || undefined, stockMode: 'proprio' });
      const j = r.json as { ok?: boolean; integracaoApiKey?: string; url?: string; error?: string };
      if (r.status >= 300 || !j.ok || !j.integracaoApiKey) { console.error(`Catálogo: ligar loja ${loja.name} ao Estoque falhou:`, j.error || r.status); continue; }
      const { error } = await admin.from('store_ntb_estoque_secrets').upsert(
        { store_id: loja.id, ntb_estoque_url: j.url || base, ntb_estoque_api_key: j.integracaoApiKey, ativo: true, updated_at: new Date().toISOString() },
        { onConflict: 'store_id' }
      );
      if (!error) n++;
    } catch (e) { console.error(`Catálogo: ligar loja ${loja.name} ao Estoque falhou:`, e); }
  }
  return n;
}

/** Entrega o outbox de uma loja ao Estoque e grava de volta os códigos/ids criados lá. */
export async function drenarOutbox(admin: Admin, secret: Secret, limite = 100): Promise<{ entregues: number; falhas: number }> {
  const { data: fila } = await admin
    .from('sync_estoque_outbox').select('id, entidade, ref, operacao, payload, tentativas')
    .eq('store_id', secret.store_id).eq('status', 'pending').lte('proxima_tentativa', new Date().toISOString())
    .order('id').limit(limite);
  if (!fila?.length) return { entregues: 0, falhas: 0 };

  const ids = (e: string) => fila.filter((f) => f.entidade === e && f.operacao === 'upsert').map((f) => f.ref as string);
  const { data: catalogo, error: eCat } = await admin.rpc('catalogo_para_estoque', {
    p_store: secret.store_id, p_produtos: ids('produto'), p_categorias: ids('categoria'), p_grupos: ids('grupo'),
  });
  const payload = (catalogo ?? { grupos: [], produtos: [] }) as { grupos: unknown[]; produtos: Record<string, unknown>[] };
  // produto apagado no Vendas: o Estoque só desativa (nunca apaga)
  for (const f of fila.filter((x) => x.entidade === 'produto' && x.operacao === 'delete')) {
    const p = (f.payload ?? {}) as { codigo?: string };
    if (p.codigo) payload.produtos.push({ codigo: p.codigo, nome: '', preco: 0, ativo: false, mae: false, updated_at: new Date().toISOString() });
  }

  let erro: string | null = eCat ? eCat.message : null;
  let resposta: RespostaEstoque | null = null;
  if (!erro) {
    try {
      const r = await chamar(`${secret.ntb_estoque_url.replace(/\/$/, '')}/api/integracao/catalogo`, secret.ntb_estoque_api_key, { origem: 'vendas', ...payload });
      resposta = r.json as RespostaEstoque;
      if (r.status >= 300 || !resposta?.ok) erro = resposta?.error || `Estoque respondeu HTTP ${r.status}`;
    } catch (e) { erro = e instanceof Error ? e.message : String(e); }
  }

  const agora = new Date().toISOString();
  if (!erro && resposta) {
    await admin.from('sync_estoque_outbox').update({ status: 'ok', erro: null, updated_at: agora }).in('id', fila.map((f) => f.id as number));
    await admin.rpc('aplicar_mapa_estoque', {
      p_store: secret.store_id,
      p_mapa: {
        grupos: (resposta.grupos ?? []).map((g) => ({ vendas_ref: g.vendas_ref, estoque_id: g.grupo_id })),
        produtos: (resposta.produtos ?? []).filter((p) => p.codigo).map((p) => ({ vendas_ref: p.vendas_ref, codigo: p.codigo })),
        entregues: ids('produto'),
      },
    });
    await admin.from('sync_estoque_divergencias').update({ resolvido_em: agora }).eq('store_id', secret.store_id).eq('tipo', 'erro_entrega').is('resolvido_em', null);
    return { entregues: fila.length, falhas: 0 };
  }

  for (const f of fila) {
    const t = (f.tentativas as number) + 1;
    const esgotou = t >= MAX_TENTATIVAS;
    await admin.from('sync_estoque_outbox').update({ tentativas: t, erro, status: esgotou ? 'erro' : 'pending', proxima_tentativa: proxima(t), updated_at: agora }).eq('id', f.id);
    if (esgotou) {
      await admin.from('sync_estoque_divergencias').upsert(
        { store_id: secret.store_id, entidade: f.entidade, ref: f.ref, tipo: 'erro_entrega', detalhe: erro },
        { onConflict: 'store_id,entidade,ref,tipo', ignoreDuplicates: true }
      );
    }
  }
  return { entregues: 0, falhas: fila.length };
}

export interface ResumoCatalogo { ligadas: number; enfileirados: number; entregues: number; falhas: number }

/** Um ciclo completo: liga lojas pendentes, reconcilia (enfileira o que falta) e entrega. Nunca lança. */
export async function ciclarCatalogoEstoque(opts: { soLoja?: string } = {}): Promise<ResumoCatalogo | null> {
  if (cicloEmExecucao) return null;
  cicloEmExecucao = true;
  const resumo: ResumoCatalogo = { ligadas: 0, enfileirados: 0, entregues: 0, falhas: 0 };
  try {
    const admin = getSupabaseAdmin();
    try { resumo.ligadas = await vincularLojasPendentes(admin); } catch (e) { console.error('Catálogo: erro ao ligar lojas:', e); }
    let q = admin.from('store_ntb_estoque_secrets').select('store_id, ntb_estoque_url, ntb_estoque_api_key').eq('ativo', true);
    if (opts.soLoja) q = q.eq('store_id', opts.soLoja);
    const { data: secrets } = await q;
    if (!secrets?.length) return resumo;
    const { data: proprias } = await admin.from('stores').select('id').eq('stock_mode', 'proprio').in('id', secrets.map((s) => s.store_id));
    const ok = new Set((proprias ?? []).map((s) => s.id as string));
    for (const s of secrets.filter((x) => ok.has(x.store_id as string)) as Secret[]) {
      try {
        const { data: n } = await admin.rpc('enfileirar_catalogo_pendente', { p_store: s.store_id });
        resumo.enfileirados += Number(n) || 0;
        const r = await drenarOutbox(admin, s);
        resumo.entregues += r.entregues; resumo.falhas += r.falhas;
      } catch (e) { console.error(`Catálogo: erro na loja ${s.store_id}:`, e); }
    }
  } finally {
    cicloEmExecucao = false;
  }
  if (resumo.ligadas || resumo.enfileirados || resumo.entregues || resumo.falhas) console.log('Catálogo Vendas -> Estoque, ciclo:', JSON.stringify(resumo));
  return resumo;
}
