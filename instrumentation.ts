// Hook oficial do Next.js (estável desde a 15; aqui rodamos a 16.2.9, sem
// nenhuma flag experimental necessária — não há `experimental.instrumentationHook`
// em next.config.ts de propósito). `register()` roda UMA VEZ quando o processo
// do servidor sobe, nunca a cada request.
//
// É aqui que vive o job de retransmissão das notas fiscais emitidas em
// contingência offline: o app roda como processo systemd contínuo no Contabo
// (não é serverless), então um setInterval de longa duração dentro do próprio
// processo basta — não precisa de cron externo nem de fila.
export async function register() {
  // Fuso do processo = Brasil. O servidor do Contabo roda em Europe/Berlin (+5h): as bibliotecas de PDF/cupom
  // (nfe-danfe-pdf, node-sped-pdf) formatam dhEmi no fuso do processo, então a nota emitida às 21h de 05/10
  // saía impressa como 06/10 02h. Vale pra TODA data formatada no servidor (CSV, contingência, PDFs).
  process.env.TZ = 'America/Sao_Paulo';
  // `register()` também é invocado pro runtime Edge; o job usa Node puro
  // (https, node-forge, pdfkit) e Supabase com service role — só faz sentido,
  // e só funciona, no runtime Node.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // `npm run dev` local conecta no banco de produção (ver AGENTS.md): sem
  // esta trava, um dev server de teste viraria um SEGUNDO processo
  // retransmitindo as mesmas notas pra SEFAZ ao mesmo tempo que o servidor
  // (o job não tem lock distribuído — assume processo único).
  const fiscalDesligado = process.env.DISABLE_FISCAL_RETRANSMISSAO === '1';
  if (fiscalDesligado) {
    console.log('Retransmissão fiscal de contingência: desligada neste processo (DISABLE_FISCAL_RETRANSMISSAO=1).');
  } else {
    const { verificarNotasEmContingencia } = await import('./lib/fiscal/retransmissao');

    const DOIS_MINUTOS = 2 * 60 * 1000;
    setInterval(() => {
      // `.catch` obrigatório: uma rejeição não tratada dentro de um setInterval
      // derrubaria o processo inteiro do servidor (unhandled rejection) — o job
      // fiscal nunca pode tirar o PDV do ar.
      verificarNotasEmContingencia().catch((e) => console.error('Erro no ciclo de retransmissão fiscal:', e));
    }, DOIS_MINUTOS);

    console.log('Retransmissão fiscal de contingência: ciclo agendado a cada 2 minutos.');
  }

  // Relatório diário de auditoria: às 00:00 (Brasília) manda o do dia anterior. Só envia com AUDIT_REPORT_SEND=1 (lib/relatorioAuditoriaEnvio.ts).
  if (!fiscalDesligado) {
    const { verificarEnvioDiario } = await import('./lib/relatorioAuditoriaEnvio');
    setInterval(() => { verificarEnvioDiario().catch((e) => console.error('Ciclo do relatório de auditoria:', e)); }, 60 * 1000);
  }

  // Job da baixa de estoque (outbox, migration 156): reenvia ao Estoque só o que está comprovadamente não gravado e
  // varre pedidos que o navegador não registrou. Desligado por DISABLE_BAIXA_RETRY=1 ou, como o job fiscal, em dev
  // (DISABLE_FISCAL_RETRANSMISSAO=1): `npm run dev` fala com o banco de produção e não pode virar um segundo processo
  // mandando baixa pro Estoque.
  if (process.env.DISABLE_BAIXA_RETRY === '1' || fiscalDesligado) {
    console.log('Baixa de estoque (reenvio): desligada neste processo (DISABLE_BAIXA_RETRY=1 ou DISABLE_FISCAL_RETRANSMISSAO=1).');
    return;
  }
  // Catálogo Vendas <-> Estoque (migration 170, lojas stock_mode='proprio'): entrega o outbox, liga lojas pendentes e reconcilia.
  const { ciclarCatalogoEstoque } = await import('./lib/catalogoSync');
  const intervaloCatalogoMs = Number(process.env.CATALOGO_SYNC_INTERVALO_MS) || 2 * 60 * 1000;
  setInterval(() => {
    ciclarCatalogoEstoque().catch((e) => console.error('Erro no ciclo do catálogo:', e));
  }, intervaloCatalogoMs);
  console.log(`Catálogo Vendas -> Estoque: ciclo agendado a cada ${Math.round(intervaloCatalogoMs / 1000)} s.`);

  const { ciclarBaixasDeEstoque } = await import('./lib/baixaEstoqueRetry');
  const intervaloMs = Number(process.env.BAIXA_RETRY_INTERVALO_MS) || 2 * 60 * 1000;
  setInterval(() => {
    ciclarBaixasDeEstoque().catch((e) => console.error('Erro no ciclo da baixa de estoque:', e));
  }, intervaloMs);
  console.log(`Baixa de estoque (reenvio): ciclo agendado a cada ${Math.round(intervaloMs / 1000)} s.`);
}
