import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { lerTokens, sessaoValePara, type SessaoRow } from './sessaoRegra';

// Sessão nas rotas sensíveis de /api (Task 5). Só bloqueia quando `seg_flags.exigir_sessao` = true (migration 182): com a
// chave desligada, app antigo (sem o cabeçalho) segue funcionando. Ligada, a chamada precisa de `x-ntb-sessao` com um token
// de sessoes_app não vencido, da mesma loja (ou Master/universal). storeId null = só Master/universal.
// Devolve null quando pode seguir; senão a resposta 401 pronta.
export async function exigirSessao(req: Request, storeId: string | null): Promise<null | NextResponse> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return null; // servidor sem service role: as rotas já falham sozinhas logo adiante
  }
  const { data: flag, error: erroFlag } = await admin.from('seg_flags').select('valor').eq('chave', 'exigir_sessao').maybeSingle();
  // Erro lendo a chave (banco sem a 182): não bloqueia — mesmo comportamento de _sessao_ok com a chave desligada.
  if (erroFlag || !flag?.valor) return null;

  const tokens = lerTokens(req.headers.get('x-ntb-sessao'));
  if (tokens.length > 0) {
    const { data: sessoes } = await admin.from('sessoes_app').select('tipo, store_id, expira_em').in('token', tokens);
    if (sessaoValePara((sessoes || []) as SessaoRow[], storeId)) return null;
  }
  return NextResponse.json(
    { success: false, ok: false, sessaoVencida: true, message: 'Sessão vencida. Saia e entre de novo.', reason: 'Sessão vencida. Saia e entre de novo.' },
    { status: 401 },
  );
}
