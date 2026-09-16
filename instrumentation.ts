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
  // `register()` também é invocado pro runtime Edge; o job usa Node puro
  // (https, node-forge, pdfkit) e Supabase com service role — só faz sentido,
  // e só funciona, no runtime Node.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

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
