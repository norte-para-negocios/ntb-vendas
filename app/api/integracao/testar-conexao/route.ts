import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { resumirConexao, type LeituraEstoque } from '@/lib/estoqueConexao';

// "Testar conexão" da aba Integrações: só LEITURAS inofensivas ao Estoque (locais + status). Não cria OP, não chama o Omie.
// A chave fica em store_ntb_estoque_secrets (só service role lê), por isso o teste roda aqui e não no navegador.
// Mesmo modelo de confiança de /api/integracao/locais-estoque (storeId vindo do painel).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ler(url: string, chave: string): Promise<LeituraEstoque> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${chave}` }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    return { status: res.status, json: await res.json().catch(() => null) };
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string } };
    return { status: null, erroRede: err.name === 'TimeoutError' ? 'sem resposta em 10 s' : err.cause?.code ?? 'falha de rede' };
  }
}

export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get('storeId') ?? '';
  if (!UUID_RE.test(storeId)) return NextResponse.json({ configurado: false, erro: 'storeId inválido' }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: secret } = await admin.from('store_ntb_estoque_secrets').select('ntb_estoque_url, ntb_estoque_api_key, ativo').eq('store_id', storeId).maybeSingle();
  if (!secret?.ntb_estoque_url || !secret.ntb_estoque_api_key) return NextResponse.json({ configurado: false });

  const raiz = secret.ntb_estoque_url.replace(/\/$/, '');
  const [locais, status] = await Promise.all([
    ler(`${raiz}/api/integracao/locais-estoque`, secret.ntb_estoque_api_key),
    ler(`${raiz}/api/integracao/status`, secret.ntb_estoque_api_key),
  ]);
  return NextResponse.json({ configurado: true, ativo: !!secret.ativo, ...resumirConexao(locais, status) });
}
