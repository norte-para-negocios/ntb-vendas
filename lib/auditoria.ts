// Auditoria de funcionários (06/10/2026, migration 163). Duas fontes:
//  - o BANCO grava sozinho toda mudança de linha (triggers), usando o ator do cabeçalho X-NTB-Actor (lib/atorAtual.ts);
//  - o APP grava aqui o que não muda linha nenhuma: login, logout, reimpressão, exportação, pausa de impressão...
// Nunca bloqueia nem atrasa a ação: falha vira fila local e é reenviada na próxima chamada.
import { supabase } from '@/lib/supabaseClient';
import { obterAtor } from '@/lib/atorAtual';

const CHAVE_FILA = 'ntb_audit_pendentes';
const MAX_FILA = 200;

type Pendente = { storeId: string | null; action: string; entity: string | null; entityId: string | null; summary: string | null; details: Record<string, unknown>; occurredAt: string; actor: unknown };

function lerFila(): Pendente[] {
  try { return JSON.parse(localStorage.getItem(CHAVE_FILA) || '[]'); } catch { return []; }
}
function gravarFila(f: Pendente[]) {
  try { localStorage.setItem(CHAVE_FILA, JSON.stringify(f.slice(-MAX_FILA))); } catch { /* sem armazenamento */ }
}

async function enviar(p: Pendente): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('log_staff_action_secure', {
      p_store_id: p.storeId, p_action: p.action, p_entity: p.entity, p_entity_id: p.entityId,
      p_summary: p.summary, p_details: p.details, p_occurred_at: p.occurredAt, p_actor: p.actor,
    });
    return !error;
  } catch { return false; }
}

let reenviando = false;
export async function reenviarPendentes() {
  if (reenviando) return;
  reenviando = true;
  try {
    const fila = lerFila();
    if (!fila.length) return;
    const restantes: Pendente[] = [];
    for (const p of fila) { if (!(await enviar(p))) restantes.push(p); }
    gravarFila(restantes);
  } finally { reenviando = false; }
}

export function registrarAcao(
  storeId: string | null | undefined,
  action: string,
  opts: { entity?: string; entityId?: string; summary?: string; details?: Record<string, unknown> } = {},
): void {
  const a = obterAtor();
  const p: Pendente = {
    storeId: storeId ?? null, action, entity: opts.entity ?? null, entityId: opts.entityId ?? null,
    summary: opts.summary ?? null, details: opts.details ?? {}, occurredAt: new Date().toISOString(),
    actor: a ? { id: a.id, name: a.name, role: a.role } : null,
  };
  void (async () => {
    if (await enviar(p)) { void reenviarPendentes(); return; }
    gravarFila([...lerFila(), p]);
  })().catch(() => { /* auditoria nunca quebra a ação */ });
}
