import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { extrairCertificado } from '@/lib/fiscal/certificado';

type Admin = ReturnType<typeof getSupabaseAdmin>;

// Linha de `store_fiscal_config` (select('*')). Só os campos que o pipeline
// fiscal realmente lê estão tipados — a tabela tem mais colunas, mas listar
// só o que é consumido evita um tipo que mente sobre o schema.
export interface ConfigFiscalLoja {
  modelo_emissao_automatica: 'nenhuma' | 'nfe' | 'nfce' | string;
  ambiente: 'homologacao' | 'producao';
  nfe_serie: number | null;
  nfce_serie: number | null;
  inscricao_estadual: string | null;
  razao_social: string | null;
  endereco_logradouro: string | null;
  endereco_numero: string | null;
  endereco_bairro: string | null;
  endereco_cidade: string | null;
  endereco_uf: string | null;
  endereco_cep: string | null;
  cst_csosn_padrao: string | null;
  cst_pis_padrao: string | null;
  cst_cofins_padrao: string | null;
  cnpj_autorizado: string | null;
  telefone: string | null;
}

export interface MetadadosCertificadoLoja {
  filePath: string;
  chainPem: string | null;
  senha: string;
}

export interface CertificadoLoja {
  certPem: string;
  keyPem: string;
  /**
   * certPem + cadeia da AC emissora concatenados — é ESTE valor que vai pro
   * `certPem` de `transmitirNota`, nunca o certificado folha sozinho (a SEFAZ
   * precisa da cadeia no handshake mTLS).
   */
  certComCadeia: string;
  cnpjCertificado: string | null;
}

export interface CredenciaisFiscaisLoja extends CertificadoLoja {
  config: ConfigFiscalLoja;
}

// ─────────────────────────────────────────────────────────────────────────
// Peças granulares. Existem separadas (em vez de só a função composta lá
// embaixo) porque `app/api/fiscal/emitir/route.ts` precisa delas em DOIS
// momentos distintos do seu fluxo, com efeitos colaterais diferentes entre
// eles (early-exit `skipped` quando falta config/certificado, versus gravar
// uma linha 'erro' em fiscal_notas quando o certificado existe mas não abre
// ou não bate com o CNPJ da loja). Colapsar tudo num único ponto de chamada
// lá mudaria a ORDEM desses efeitos — exatamente o tipo de mudança silenciosa
// de comportamento que não se faz num refactor de código fiscal.
// ─────────────────────────────────────────────────────────────────────────

export async function carregarConfigFiscalDaLoja(
  admin: Admin,
  storeId: string,
): Promise<ConfigFiscalLoja | null> {
  const { data } = await admin.from('store_fiscal_config').select('*').eq('store_id', storeId).maybeSingle();
  return (data as ConfigFiscalLoja | null) ?? null;
}

// Metadados + senha do certificado (duas tabelas: a pública com o caminho no
// Storage e a cadeia, e a de secrets com a senha do .pfx). Devolve null se
// QUALQUER uma das duas faltar — sem as duas juntas não dá pra abrir o .pfx,
// então "meia configuração" é equivalente a loja sem certificado.
export async function carregarMetadadosCertificadoDaLoja(
  admin: Admin,
  storeId: string,
): Promise<MetadadosCertificadoLoja | null> {
  const { data: certMeta } = await admin
    .from('store_fiscal_certificates')
    .select('file_path, chain_pem')
    .eq('store_id', storeId)
    .maybeSingle();
  const { data: certSecret } = await admin
    .from('store_fiscal_certificate_secrets')
    .select('password')
    .eq('store_id', storeId)
    .maybeSingle();

  if (!certMeta || !certSecret?.password) return null;
  return {
    filePath: certMeta.file_path as string,
    chainPem: (certMeta.chain_pem as string | null) ?? null,
    senha: certSecret.password as string,
  };
}

// Baixa o .pfx do Storage e extrai cert+chave em PEM, já concatenando a
// cadeia da AC (guardada em `store_fiscal_certificates.chain_pem` no upload —
// ver lib/fiscal/certificado.ts:resolverCadeiaCertificado, que roda naquele
// momento, não aqui). Lança em qualquer falha: quem chama decide o que fazer
// (a rota grava 'erro'; a retransmissão só loga e tenta no próximo ciclo).
export async function extrairCertificadoDaLoja(
  admin: Admin,
  meta: MetadadosCertificadoLoja,
): Promise<CertificadoLoja> {
  const certBucket = admin.storage.from('store-certificates');
  const { data: pfxFile, error: pfxErr } = await certBucket.download(meta.filePath);
  if (pfxErr || !pfxFile) throw new Error('Não foi possível baixar o certificado digital.');
  const pfxBuffer = Buffer.from(await pfxFile.arrayBuffer());
  const { certPem, keyPem, cnpjCertificado } = extrairCertificado(pfxBuffer, meta.senha);
  const certComCadeia = meta.chainPem ? `${certPem}\n${meta.chainPem}` : certPem;
  return { certPem, keyPem, certComCadeia, cnpjCertificado };
}

// ─────────────────────────────────────────────────────────────────────────
// Função composta: tudo o que é preciso pra chamar `transmitirNota` por uma
// loja, numa chamada só. Usada pela retransmissão em background
// (lib/fiscal/retransmissao.ts), que — diferente da rota de emissão — não
// tem nenhum fluxo de early-exit/gravação intermediária pra preservar: ou
// consegue carregar tudo, ou a nota fica em contingência pro próximo ciclo.
// Lança (não devolve null) em qualquer ausência: pra uma nota que JÁ está em
// contingência, loja sem config/certificado não é um "pular normal", é uma
// anomalia que precisa aparecer no log.
// ─────────────────────────────────────────────────────────────────────────
export async function carregarCredenciaisFiscaisDaLoja(
  admin: Admin,
  storeId: string,
): Promise<CredenciaisFiscaisLoja> {
  const config = await carregarConfigFiscalDaLoja(admin, storeId);
  if (!config) throw new Error(`Loja ${storeId} sem store_fiscal_config.`);

  const meta = await carregarMetadadosCertificadoDaLoja(admin, storeId);
  if (!meta) throw new Error(`Loja ${storeId} sem certificado digital configurado.`);

  const certificado = await extrairCertificadoDaLoja(admin, meta);
  return { ...certificado, config };
}
