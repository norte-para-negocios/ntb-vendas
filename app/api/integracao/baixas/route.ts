import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { carregarLinha, processarBaixa, conferirBaixa } from '@/lib/baixaEstoqueServidor';

// Ações do gerente sobre uma baixa de estoque do outbox (migration 156), em Administração > Configurações > Integrações:
//  - reprocessar: "Tentar de novo". Reenvia SÓ os itens com erro comprovadamente não gravado no Estoque; item incerto
//    NUNCA é reenviado (a criação da OP não é idempotente: duplicaria).
//  - conferir: o gerente olhou no Estoque e confirma que o item incerto já foi baixado ("Já conferi").
// Mesmo modelo de confiança de /api/integracao/configurar (storeId vindo do painel; autenticação das rotas é outro trabalho).
// A tela só mostra os botões para dono/gerente (permissão editar_cardapio).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { storeId?: string; id?: string; acao?: string; quem?: string } | null;
  if (!body?.storeId || !UUID_RE.test(body.storeId) || !body.id || !UUID_RE.test(body.id) || (body.acao !== 'reprocessar' && body.acao !== 'conferir')) {
    return NextResponse.json({ success: false, message: 'Dados inválidos.' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();
  const linha = await carregarLinha(admin, body.id, body.storeId);
  if (!linha) return NextResponse.json({ success: false, message: 'Baixa não encontrada.' }, { status: 404 });

  try {
    if (body.acao === 'conferir') {
      const status = await conferirBaixa(admin, linha, (body.quem || 'gerente').slice(0, 60));
      return NextResponse.json({ success: true, status });
    }
    const r = await processarBaixa(admin, linha, { manual: true });
    if (!r.processada) {
      const message = r.motivo === 'Nada a reenviar'
        ? 'Não há item que possa ser reenviado com segurança. Os itens "para conferir" podem já ter sido baixados no Estoque: confira lá e use "Já conferi".'
        : 'Esta baixa está sendo enviada agora. Tente de novo em instantes.';
      return NextResponse.json({ success: false, message, status: r.status });
    }
    return NextResponse.json({ success: true, status: r.status, enviados: r.enviados });
  } catch (e) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'Falha ao reprocessar a baixa.' }, { status: 500 });
  }
}
