import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { PAYMENT_METHOD_LABELS, CARD_BRAND_LABELS } from '@/lib/labels';
import { getPaymentMethodsForRecord } from '@/lib/calc';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cap arbitrário mas generoso — nenhuma comanda real de balcão precisa de
// mais que isso; existe só pra impedir um payload absurdo (o resto da
// validação abaixo já rejeita QUALQUER item malformado, este limite é só
// contra volume, mesmo espírito do limite de 100 itens/30 opções em
// create_order_secure, migration 017).
const MAX_METHODS = 20;

// Fix round 4 (Group A2): payload runtime validado contra os dois catálogos
// fechados de lib/labels.ts antes de gravar em jsonb. Sem isto, o
// TypeScript de `RequestBody` é só compile-time — a rota gravaria qualquer
// shape que chegasse por HTTP. Downstream, StoreModule.tsx (linha ~5936)
// renderiza `payment_details.methods.map(...)` e `m.amount.toFixed(2)` sem
// guarda nenhuma: um `methods` truthy não-array, ou um `amount` string,
// quebra o modal de detalhe de venda do lojista assim que ele abrir aquele
// pedido — mesma classe de DoS via jsonb já fechada do lado da Estação
// neste branch (fix round 2, Group A). Já é alcançável hoje via
// close_table_orders_secure (RPC pública, sem validação de shape) — não é
// regressão desta rota, mas é o lugar certo pra parar aqui também.
function isValidPaymentDetails(
  details: unknown
): details is { total: number; methods: { method: string; amount: number; brand?: string | null }[]; emitir_nota?: boolean; cash_shift_id?: string } {
  if (!details || typeof details !== 'object') return false;
  const d = details as Record<string, unknown>;
  if (!Number.isFinite(d.total)) return false;
  if (!Array.isArray(d.methods)) return false;
  if (d.methods.length === 0 || d.methods.length > MAX_METHODS) return false;
  // Task 4 (2026-08-23): `emitir_nota`, quando presente, precisa ser
  // boolean de verdade — mesmo princípio de validação estrita de shape já
  // seguido no resto desta function (nunca confiar que o JSON que chegou
  // bate com o tipo TypeScript só porque o compilador achou bonito).
  if (d.emitir_nota !== undefined && typeof d.emitir_nota !== 'boolean') return false;
  // Task 2 (2026-08-23, plano frente-de-caixa, correção pós-revisão):
  // `cash_shift_id`, quando presente, precisa ser string — mesmo princípio
  // do `emitir_nota` acima. Sem esta checagem, o campo atravessava a
  // validação "de graça" (chaves desconhecidas não são rejeitadas aqui) e
  // qualquer shape (número, objeto, array) chegaria intacto até
  // `orders.payment_details`. Não valida formato UUID estrito — só o tipo,
  // suficiente pra impedir o shape errado de ser persistido.
  if (d.cash_shift_id !== undefined && typeof d.cash_shift_id !== 'string') return false;

  return d.methods.every((m) => {
    if (!m || typeof m !== 'object') return false;
    const method = m as Record<string, unknown>;
    if (typeof method.method !== 'string' || !(method.method in PAYMENT_METHOD_LABELS)) return false;
    if (!Number.isFinite(method.amount)) return false;
    if (method.brand !== undefined && method.brand !== null) {
      if (typeof method.brand !== 'string' || !(method.brand in CARD_BRAND_LABELS)) return false;
    }
    return true;
  });
}

// Módulo Caixa (Task 5, 2026-08-22, plano perfis-de-loja-e-caixa — fecha o
// gap do Balcão): grava payment_method/payment_details de um pedido de
// BALCÃO. Ver o comentário completo em lib/api.ts (closeCounterOrder) pro
// porquê disto não ser uma RPC nova — resumo: close_counter_order_secure só
// grava status; close_table_orders_secure grava pagamento mas filtra por
// table_id, e balcão nasce com table_id null (NULL = NULL nunca bate em
// SQL); e o plano proíbe migration/coluna/RPC nova pra fechar este gap
// (restrição explícita da Task 5). `orders` não tem SELECT/UPDATE público
// pra anon desde a correção de segurança 021/022 (ver AGENTS.md) — esta
// rota (service role, mesmo padrão de /api/certificado e
// /api/integracao/ordem-producao) é o único jeito de escrever aqui sem
// tocar em RLS/RPC/schema.
//
// Chamada síncrona (NÃO fire-and-forget, ao contrário de
// /api/integracao/ordem-producao e /api/fiscal/emitir): registrar o
// pagamento é o próprio propósito desta feature, não um efeito colateral
// best-effort — se isto falhar, closeCounterOrder (lib/api.ts) nunca chama
// close_counter_order_secure, e o pedido continua aberto em vez de "fechado
// sem ninguém saber como foi pago".
//
// Guarda `status not in ('delivered','canceled')` (mesmo espírito do
// `where table_id = p_table_id and status not in (...)` de
// close_table_orders_secure): nunca sobrescreve o pagamento de um pedido já
// fechado por engano (ex.: um retry tardio depois de outro caminho já ter
// fechado o mesmo pedido).
interface RequestBody {
  orderId?: string;
  paymentMethod?: string;
  paymentDetails?: {
    total: number;
    methods: { method: string; amount: number; brand?: string | null }[];
    emitir_nota?: boolean;
    cash_shift_id?: string;
  };
  // Task 5 (2026-09-13, correções da revisão independente): quando `true`,
  // esta requisição é o CAMINHO INVERSO — desfaz o pagamento em vez de
  // gravar um. Ver o bloco de estorno no handler.
  estornar?: boolean;
  // Só no estorno (fix round 1 da Task 5). `storeId` fecha o buraco de
  // rota cross-loja (I2) e os dois campos de operador alimentam a trilha
  // de auditoria (C1, migration 074) — `operatorUserId` é null pra conta
  // universal, mesmo critério do resto do projeto (ver AGENTS.md, "Conta
  // universal"). `confirmarNotaAutorizada` é o de-acordo explícito de que
  // existe nota fiscal AUTORIZADA desta venda e o estorno não cancela nada
  // na SEFAZ (I1).
  storeId?: string;
  operatorUserId?: string | null;
  operatorName?: string;
  confirmarNotaAutorizada?: boolean;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;

  // orderId é a única coisa exigida pelos DOIS caminhos (pagar e estornar),
  // então valida antes de qualquer bifurcação — o estorno não manda
  // paymentMethod/paymentDetails nenhum.
  if (!body?.orderId) {
    return NextResponse.json(
      { success: false, message: 'Dados de pagamento incompletos.' },
      { status: 400 }
    );
  }

  // Fix round 4 (Group A3): mesma validação de app/api/certificado (storeId)
  // — orderId nunca deveria chegar ao Postgres sem ter essa forma; um
  // orderId qualquer (não-UUID) só bateria em zero linhas de qualquer
  // forma, mas validar aqui evita depender do banco pra rejeitar lixo.
  if (typeof body.orderId !== 'string' || !UUID_RE.test(body.orderId)) {
    return NextResponse.json({ success: false, message: 'orderId inválido.' }, { status: 400 });
  }

  // Validação estrita do campo novo, mesmo espírito de `emitir_nota`/
  // `cash_shift_id` em isValidPaymentDetails: nunca confiar que o JSON que
  // chegou bate com o tipo TypeScript. Só `true` estorna; qualquer outro
  // valor que não seja boolean é payload malformado e é rejeitado, em vez
  // de cair silenciosamente no caminho de pagamento (um `estornar: "true"`
  // string cobrando o cliente é o pior desfecho possível aqui).
  if (body.estornar !== undefined && typeof body.estornar !== 'boolean') {
    return NextResponse.json({ success: false, message: 'estornar inválido.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Estorno: limpa o pagamento de um pedido de balcão que ainda NÃO foi
  // entregue. Existe porque o fluxo "paga primeiro" criou uma janela real
  // entre receber e entregar (cliente desiste, caixa cobrou o pedido
  // errado, maquininha recusou depois). Nunca toca em pedido já entregue —
  // desfazer venda fechada é outro problema, com implicação fiscal.
  if (body.estornar === true) {
    // I2 (fix round 1): sem `storeId`, esta rota era cross-loja — ela roda
    // com service role e aceitava só o `orderId`, que o PRÓPRIO CLIENTE
    // final recebe de volta de `create_order_secure`. Qualquer um com um
    // UUID de pedido apagava o pagamento dele em QUALQUER loja da
    // plataforma, quantas vezes quisesse (ao contrário do caminho de
    // pagamento, que ao menos é idempotente pela guarda
    // `payment_details is null`). O `storeId` vira filtro do UPDATE lá
    // embaixo: pedido de outra loja simplesmente não é encontrado.
    if (typeof body.storeId !== 'string' || !UUID_RE.test(body.storeId)) {
      return NextResponse.json({ success: false, message: 'storeId inválido.' }, { status: 400 });
    }
    // C1: identidade do operador é OBRIGATÓRIA no estorno — é o dado que
    // faltava pra trilha de auditoria existir. `operatorUserId` null é
    // legítimo (conta universal, que não é uma linha de `store_users`);
    // `operatorName` nunca é, porque é a única coisa que aparece na aba
    // Auditoria pra dizer QUEM fez.
    if (body.operatorUserId !== undefined && body.operatorUserId !== null) {
      if (typeof body.operatorUserId !== 'string' || !UUID_RE.test(body.operatorUserId)) {
        return NextResponse.json({ success: false, message: 'operatorUserId inválido.' }, { status: 400 });
      }
    }
    const operatorName = typeof body.operatorName === 'string' ? body.operatorName.trim() : '';
    if (!operatorName || operatorName.length > 120) {
      return NextResponse.json({ success: false, message: 'operatorName inválido.' }, { status: 400 });
    }
    if (body.confirmarNotaAutorizada !== undefined && typeof body.confirmarNotaAutorizada !== 'boolean') {
      return NextResponse.json({ success: false, message: 'confirmarNotaAutorizada inválido.' }, { status: 400 });
    }

    // Fix round 2 (Important 4a): o `operator_user_id` do evento de
    // auditoria tem FK pra `store_users`. Um id que não existe (ou de
    // outra loja) só estouraria lá embaixo como violação de FK → 500
    // genérico, bloqueando um estorno legítimo sem explicar nada. Validar
    // aqui devolve o motivo certo e, de quebra, levanta a barra contra
    // identidade forjada: `store_users` não tem SELECT anônimo desde a
    // migration 014, então um cliente não tem como descobrir um id válido
    // desta loja pra chutar. (Não é autenticação — a identidade continua
    // sendo afirmação do client, dívida de fundo do projeto inteiro.)
    if (body.operatorUserId) {
      const { data: operador, error: erroOperador } = await admin
        .from('store_users')
        .select('id')
        .eq('id', body.operatorUserId)
        .eq('store_id', body.storeId)
        .maybeSingle();
      if (erroOperador) {
        console.error('pagamento-balcao: falha ao validar operador:', erroOperador);
        return NextResponse.json({ success: false, message: 'Falha ao estornar o pagamento.' }, { status: 500 });
      }
      if (!operador) {
        return NextResponse.json(
          { success: false, message: 'Operador não encontrado nesta loja — faça login de novo.' },
          { status: 403 }
        );
      }
    }

    // Lê ANTES de limpar: é a única chance de saber o que está sendo
    // desfeito (valor, formas, turno) — depois do UPDATE esse dado não
    // existe em lugar nenhum. Também é o que distingue os motivos de
    // recusa abaixo, em vez de um 404 genérico (M1).
    const { data: pedido, error: erroLeitura } = await admin
      .from('orders')
      .select('id, status, payment_details')
      .eq('id', body.orderId)
      .eq('store_id', body.storeId)
      .eq('order_type', 'counter')
      .maybeSingle();
    if (erroLeitura) {
      console.error('pagamento-balcao: falha ao ler pedido pra estorno:', erroLeitura);
      return NextResponse.json({ success: false, message: 'Falha ao estornar o pagamento.' }, { status: 500 });
    }
    if (!pedido) {
      return NextResponse.json(
        { success: false, message: 'Pedido de balcão não encontrado nesta loja.' },
        { status: 404 }
      );
    }
    if (pedido.status === 'delivered' || pedido.status === 'canceled') {
      return NextResponse.json(
        { success: false, message: 'Este pedido já foi entregue/cancelado — não dá pra estornar.' },
        { status: 409 }
      );
    }
    // M1: "não tem pagamento" não é a mesma coisa que "não existe".
    const detalhes = (pedido.payment_details || null) as
      | { total?: unknown; methods?: unknown; cash_shift_id?: unknown }
      | null;
    if (!detalhes) {
      return NextResponse.json(
        { success: false, message: 'Este pedido não tem pagamento registrado — não há o que estornar.' },
        { status: 409 }
      );
    }

    // C2: o esperado do turno NÃO é congelado no fechamento — 051/052/054/
    // 057 recalculam `expected_cash`/`difference` ao vivo, lendo
    // `payment_details.cash_shift_id`, inclusive pra turno já `closed`.
    // Estornar um pagamento de um turno fechado faria aquele turno, já
    // conferido e assinado, passar a exibir uma SOBRA que nunca existiu —
    // enquanto o dinheiro de verdade está na gaveta de outro turno.
    // Ajuste de caixa já fechado é decisão de supervisor, não um clique de
    // operador.
    const cashShiftId =
      typeof detalhes.cash_shift_id === 'string' && UUID_RE.test(detalhes.cash_shift_id)
        ? detalhes.cash_shift_id
        : null;
    if (cashShiftId) {
      const { data: turno, error: erroTurno } = await admin
        .from('cash_shifts')
        .select('id, status')
        .eq('id', cashShiftId)
        .maybeSingle();
      if (erroTurno) {
        console.error('pagamento-balcao: falha ao ler turno de caixa:', erroTurno);
        return NextResponse.json({ success: false, message: 'Falha ao estornar o pagamento.' }, { status: 500 });
      }
      if (turno?.status === 'closed') {
        return NextResponse.json(
          {
            success: false,
            caixaFechado: true,
            message:
              'Esse pagamento é de um caixa já fechado — o ajuste tem que ser feito pelo supervisor.',
          },
          { status: 409 }
        );
      }
    }

    // I1: nota fiscal AUTORIZADA não é cancelada por este estorno — nem
    // pode ser, cancelamento é evento fiscal na SEFAZ, com prazo e
    // justificativa, e este projeto não tem essa rotina (ver a regra
    // crítica de emissão fiscal no AGENTS.md). Pior: como a emissão é
    // idempotente por (store_id, order_id, status='autorizada'), pagar de
    // novo depois do estorno NÃO emite nota nova — a nota antiga continua
    // sendo o documento fiscal daquela venda, mesmo que o novo pagamento
    // tenha outro valor/forma. Então o estorno só passa com um de-acordo
    // explícito de quem está operando (a tela mostra número/chave e diz
    // que a SEFAZ não é tocada).
    //
    // `.order().limit(1)` antes do `maybeSingle()` (fix round 2, Important
    // 1): a idempotência de app/api/fiscal/emitir é só checagem de
    // aplicação — NÃO existe UNIQUE em `fiscal_notas` — e já existe em
    // produção pedido com DUAS notas 'autorizada'. Com `maybeSingle()`
    // puro, esse caso virava PGRST116 → 500 genérico pra sempre, travando
    // um estorno perfeitamente legítimo sem dizer o motivo. Pega a mais
    // recente: o aviso é o mesmo de qualquer forma (existe nota autorizada
    // desta venda), e o `nota_autorizada_id` do evento aponta pra uma nota
    // real que leva o contador até as demais pelo mesmo `order_id`.
    const { data: notaAutorizada, error: erroNota } = await admin
      .from('fiscal_notas')
      .select('id, numero, serie, modelo, chave_acesso')
      .eq('store_id', body.storeId)
      .eq('order_id', body.orderId)
      .eq('status', 'autorizada')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (erroNota) {
      console.error('pagamento-balcao: falha ao checar nota fiscal:', erroNota);
      return NextResponse.json({ success: false, message: 'Falha ao estornar o pagamento.' }, { status: 500 });
    }
    if (notaAutorizada && body.confirmarNotaAutorizada !== true) {
      return NextResponse.json(
        {
          success: false,
          notaAutorizada,
          message:
            'Esta venda já tem nota fiscal autorizada — o estorno não cancela nada na SEFAZ.',
        },
        { status: 409 }
      );
    }

    // Auditoria ANTES do UPDATE, de propósito: se gravar o evento falhar,
    // nada é estornado (é exatamente o cenário que a migration 074 existe
    // pra impedir — dinheiro recebido sumindo do esperado do turno sem
    // ninguém saber quem tirou). Se o UPDATE falhar depois, o evento órfão
    // é apagado logo abaixo.
    const detalhesEvento = {
      order_id: body.orderId,
      valor: Number.isFinite(detalhes.total as number) ? (detalhes.total as number) : null,
      methods: Array.isArray(detalhes.methods) ? detalhes.methods : [],
      cash_shift_id: cashShiftId,
      nota_autorizada_id: notaAutorizada?.id ?? null,
    };
    const { data: evento, error: erroEvento } = await admin
      .from('cash_shift_audit_events')
      .insert({
        store_id: body.storeId,
        shift_id: cashShiftId,
        operator_user_id: body.operatorUserId ?? null,
        operator_name: operatorName,
        event_type: 'pagamento_estornado',
        details: detalhesEvento,
      })
      .select('id')
      .single();
    if (erroEvento) {
      // Fix round 2 (Important 4b): mensagem específica em vez de 500
      // genérico — quem está no caixa precisa saber que o estorno NÃO
      // aconteceu e por quê. Continua falhando FECHADO: sem auditoria,
      // não estorna.
      console.error('pagamento-balcao: falha ao registrar auditoria do estorno:', erroEvento);
      return NextResponse.json(
        {
          success: false,
          message:
            'Não consegui registrar a auditoria do estorno, por isso não estornei. Tente de novo; se persistir, chame o suporte.',
        },
        { status: 500 }
      );
    }

    const { data: estornado, error: erroEstorno } = await admin
      .from('orders')
      .update({ payment_method: null, payment_details: null, updated_at: new Date().toISOString() })
      .eq('id', body.orderId)
      .eq('store_id', body.storeId)
      .eq('order_type', 'counter')
      .neq('status', 'delivered')
      .neq('status', 'canceled')
      // Nunca estornar duas vezes o mesmo pagamento (espelho da guarda
      // `.is('payment_details', null)` do caminho de pagamento): entre a
      // leitura acima e este UPDATE, outro caixa pode ter estornado.
      .not('payment_details', 'is', null)
      .select('id')
      .maybeSingle();
    if (erroEstorno) {
      // Fix round 2 (Important 2): resultado INCERTO — o UPDATE pode ter
      // commitado no Postgres e só a resposta ter se perdido (blip de
      // rede, timeout do PostgREST). Apagar o evento aqui era o pior
      // desfecho possível: pagamento apagado E rastro apagado, com o
      // operador achando que falhou. O evento FICA, marcado como incerto,
      // pra quem auditar depois saber que precisa conferir o pedido.
      console.error('pagamento-balcao: falha ao estornar (resultado incerto):', erroEstorno);
      const { error: erroMarcaIncerto } = await admin
        .from('cash_shift_audit_events')
        .update({ details: { ...detalhesEvento, resultado: 'incerto' } })
        .eq('id', evento.id);
      if (erroMarcaIncerto) {
        console.error('pagamento-balcao: falha ao marcar evento de auditoria como incerto:', erroMarcaIncerto);
      }
      return NextResponse.json(
        {
          success: false,
          message:
            'Não deu pra confirmar o estorno — recarregue a tela e confira o pedido antes de tentar de novo.',
        },
        { status: 500 }
      );
    }
    if (!estornado) {
      // Aqui SIM o UPDATE respondeu e não casou nenhuma linha: o estorno
      // comprovadamente não aconteceu (outro caixa estornou antes, ou o
      // pedido mudou de estado no meio). Só neste caso o evento é
      // compensado.
      const { error: erroCompensacao } = await admin
        .from('cash_shift_audit_events')
        .delete()
        .eq('id', evento.id);
      if (erroCompensacao) {
        // Fix round 2 (Important 3): sem esta checagem, uma deleção que
        // falha deixa "Estornou pagamento de R$ X" na Auditoria de um
        // estorno que NUNCA aconteceu — rastro mentindo. Não dá pra fazer
        // mais nada em runtime além de gritar no log do servidor.
        console.error(
          'pagamento-balcao: evento de auditoria órfão (estorno não aplicado e compensação falhou), id:',
          evento.id,
          erroCompensacao
        );
      }
      return NextResponse.json(
        { success: false, message: 'O pagamento deste pedido mudou de estado — recarregue a tela e tente de novo.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: true, estornado: true });
  }

  if (!body.paymentMethod || !body.paymentDetails) {
    return NextResponse.json(
      { success: false, message: 'Dados de pagamento incompletos.' },
      { status: 400 }
    );
  }

  if (typeof body.paymentMethod !== 'string' || !(body.paymentMethod in PAYMENT_METHOD_LABELS)) {
    return NextResponse.json({ success: false, message: 'paymentMethod inválido.' }, { status: 400 });
  }

  if (!isValidPaymentDetails(body.paymentDetails)) {
    return NextResponse.json({ success: false, message: 'paymentDetails inválido.' }, { status: 400 });
  }

  // Defesa em profundidade (achado real, reunião com o Ramon, 2026-08-25):
  // não confiar que o client já normalizou o troco embutido no método CASH
  // antes de mandar pra cá — esta rota roda com service role e é a
  // autoridade de escrita real de payment_details do balcão, então
  // reaplicar a mesma normalização aqui (lib/calc.ts,
  // getPaymentMethodsForRecord) garante a invariante mesmo se algum client
  // futuro esquecer de fazer isso. Nunca rejeita — só corrige o valor
  // gravado, mesmo espírito de "nunca impedir o fechamento" já seguido no
  // resto das rotas fire-and-forget deste projeto.
  const paymentDetailsNormalizado = {
    ...body.paymentDetails,
    methods: getPaymentMethodsForRecord(body.paymentDetails.methods, body.paymentDetails.total),
    // Task 6 (fix round 1, revisão independente): o instante do PAGAMENTO,
    // não o de criação do pedido. No fluxo "paga primeiro" o pedido pode
    // ficar aberto horas antes de o caixa cobrar — `order.created_at` mede
    // outra coisa. Gravado aqui (não recalculado na tela) porque é o único
    // lugar server-side que sabe que o pagamento está acontecendo agora.
    pago_em: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from('orders')
    .update({
      payment_method: body.paymentMethod,
      payment_details: paymentDetailsNormalizado,
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.orderId)
    // Fix round 4 (Group A1): sem este filtro, o `id` sozinho bastava pra
    // reescrever payment_method/payment_details de um pedido de MESA — a
    // rota se chama pagamento-balcao e o comentário do topo do arquivo diz
    // "pedido de BALCÃO", mas nada impedia isto na prática (`close_table_
    // orders_secure`, a RPC anon com que esta rota foi comparada, não
    // consegue fazer o equivalente: ela nunca aceita um order_id solto sem
    // passar pelo table_id da mesa).
    .eq('order_type', 'counter')
    .neq('status', 'delivered')
    .neq('status', 'canceled')
    // Nunca sobrescrever um pagamento já registrado (achado de revisão
    // independente, 2026-09-13). Isto é um UPDATE, não um append: gravar de
    // novo APAGA o pagamento anterior — some do `payment_details`, some do
    // esperado em dinheiro do turno (migration 051) e some do resumo de
    // fechamento de caixa. Resultado: dois pagamentos recebidos de verdade,
    // um só registrado, e o caixa fecha com sobra sem explicação.
    // Era inofensivo enquanto pagar e fechar eram o MESMO clique (janela de
    // milissegundos); com o fluxo "paga primeiro" o pedido fica minutos
    // pago e aberto, e a segunda cobrança vira um caminho real.
    .is('payment_details', null)
    .select('id')
    .maybeSingle();

  if (error) {
    // Fix round 4 (Group A3): não ecoa error.message (PostgREST) no corpo da
    // resposta — mesmo princípio já seguido no resto do projeto (nunca
    // vazar detalhe interno de banco pro client). Log só no servidor.
    console.error('pagamento-balcao: falha ao gravar pagamento:', error);
    return NextResponse.json(
      { success: false, message: 'Falha ao registrar o pagamento.' },
      { status: 500 }
    );
  }
  if (!data) {
    // Sem isto, "já foi pago" e "não existe" davam a MESMA mensagem — e a
    // primeira é a que o operador precisa entender na hora, porque o
    // dinheiro dele já entrou uma vez. Consulta só pra explicar o motivo
    // certo (o UPDATE acima já não gravou nada de qualquer forma).
    const { data: existente } = await admin
      .from('orders')
      .select('payment_details')
      .eq('id', body.orderId)
      .eq('order_type', 'counter')
      .maybeSingle();
    if (existente?.payment_details) {
      return NextResponse.json(
        { success: false, jaPago: true, message: 'Este pedido já tem pagamento registrado.' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Pedido de balcão não encontrado ou já estava fechado.' },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
