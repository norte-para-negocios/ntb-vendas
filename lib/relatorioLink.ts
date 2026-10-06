// Link seguro do relatório de auditoria: /relatorio/<loja>.<dia>.<validade>.<assinatura>. Só quem recebe o link abre.
// A assinatura é HMAC-SHA256 com AUDIT_REPORT_TOKEN (segredo do servidor); a validade padrão é de 30 dias.
import { createHmac, timingSafeEqual } from 'node:crypto';

const assinar = (corpo: string) => createHmac('sha256', process.env.AUDIT_REPORT_TOKEN || '').update(corpo).digest('base64url');

export function gerarTokenRelatorio(storeId: string, dia: string, diasValidos = 30): string {
  const exp = Math.floor(Date.now() / 1000) + diasValidos * 86400;
  const corpo = `${storeId}.${dia}.${exp}`;
  return `${corpo}.${assinar(corpo)}`;
}

export function validarTokenRelatorio(token: string): { storeId: string; dia: string } | null {
  if (!process.env.AUDIT_REPORT_TOKEN) return null;
  const partes = token.split('.');
  if (partes.length !== 4) return null;
  const [storeId, dia, exp, sig] = partes;
  if (!/^[0-9a-f-]{36}$/i.test(storeId) || !/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^\d{9,11}$/.test(exp)) return null;
  const esperado = assinar(`${storeId}.${dia}.${exp}`);
  if (sig.length !== esperado.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return { storeId, dia };
}

export const urlRelatorio = (storeId: string, dia: string) =>
  `${process.env.AUDIT_PUBLIC_URL || 'https://nortevendas.norteparanegocios.com.br'}/relatorio/${gerarTokenRelatorio(storeId, dia)}`;
