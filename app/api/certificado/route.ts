import { NextRequest, NextResponse } from 'next/server';

// Única rota de API deste projeto (ver AGENTS.md). Existe porque TODA
// escrita relacionada ao certificado digital fiscal (arquivo + metadados +
// senha) precisa rodar com a service role key, não com a chave anônima:
//
// 1. O arquivo em si: a API de Storage do Supabase lê a linha de volta
//    depois de gravar (tipo um INSERT...RETURNING) pra montar a resposta,
//    e o `.list()` usado na limpeza (DELETE abaixo) também exige leitura.
//    Dar policy de SELECT em storage.objects pra `anon` deixaria o .pfx
//    baixável por qualquer um com a chave pública.
// 2. A senha (`store_fiscal_certificate_secrets`): mesmo sem `.select()`
//    encadeado, testado direto no banco, um `UPDATE ... WHERE store_id =
//    X` (e também um upsert com ON CONFLICT) numa tabela sem NENHUMA
//    policy de SELECT sempre afeta zero linhas — o Postgres precisa achar
//    a linha existente pra decidir se atualiza, e isso exige a mesma
//    visibilidade de leitura que uma policy de SELECT daria (confirmado
//    com EXPLAIN: o plano vira um "One-Time Filter: false" sem ela). Dar
//    policy de SELECT pra essa tabela exporia a senha em texto puro pra
//    qualquer um com a chave anônima — exatamente o que essa tabela existe
//    pra evitar.
//
// Rodando tudo aqui, com a service role key (ignora RLS por completo), o
// cliente nunca precisa nem consegue ler nenhuma das duas coisas.

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const CERT_BUCKET = 'store-certificates';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Extrai uma string não-vazia do FormData, ou `undefined` se ausente/vazia.
// Mesmo princípio já usado pra `password` acima: string vazia ou campo
// ausente = "não mexer nesse campo" (upsert parcial não sobrescreve com null).
function readOptionalString(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

// Mesma regra acima, mas convertendo pro `int` das colunas numéricas de
// store_fiscal_config (série, último número, casas decimais).
function readOptionalInt(form: FormData, key: string): number | undefined {
  const raw = readOptionalString(form, key);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const storeId = form.get('storeId');
  if (typeof storeId !== 'string' || !UUID_RE.test(storeId)) {
    return NextResponse.json({ success: false, message: 'storeId inválido.' }, { status: 400 });
  }

  const file = form.get('file');
  const originalFilename = form.get('originalFilename');
  const expiresAtRaw = form.get('expiresAt');
  const password = form.get('password');

  try {
    const supabaseAdmin = getSupabaseAdmin();

    if (file instanceof File) {
      const path = `${storeId}/certificado.pfx`;
      const { error } = await supabaseAdmin.storage.from(CERT_BUCKET).upload(path, file, { upsert: true });
      if (error) throw new Error(error.message);
    }

    if (typeof originalFilename === 'string' && originalFilename) {
      const expiresAt = typeof expiresAtRaw === 'string' && expiresAtRaw ? expiresAtRaw : null;
      const { error } = await supabaseAdmin.from('store_fiscal_certificates').upsert(
        {
          store_id: storeId,
          file_path: `${storeId}/certificado.pfx`,
          original_filename: originalFilename,
          uploaded_at: new Date().toISOString(),
          expires_at: expiresAt,
        },
        { onConflict: 'store_id' }
      );
      if (error) throw new Error(error.message);
    }

    if (typeof password === 'string' && password) {
      const { error } = await supabaseAdmin.from('store_fiscal_certificate_secrets').upsert(
        { store_id: storeId, password, updated_at: new Date().toISOString() },
        { onConflict: 'store_id' }
      );
      if (error) throw new Error(error.message);
    }

    // Configuração do emissor fiscal (campos não-sigilosos, migration 024) —
    // só grava os campos que vieram preenchidos no FormData, mesmo princípio
    // acima: upsert parcial, nunca sobrescreve o resto da linha com null.
    const configFields: Record<string, string | number> = {};

    const ambiente = readOptionalString(form, 'ambiente');
    if (ambiente === 'homologacao' || ambiente === 'producao') configFields.ambiente = ambiente;

    const nfeSerie = readOptionalInt(form, 'nfeSerie');
    if (nfeSerie !== undefined) configFields.nfe_serie = nfeSerie;
    const nfceSerie = readOptionalInt(form, 'nfceSerie');
    if (nfceSerie !== undefined) configFields.nfce_serie = nfceSerie;
    const cteSerie = readOptionalInt(form, 'cteSerie');
    if (cteSerie !== undefined) configFields.cte_serie = cteSerie;
    const mdfeSerie = readOptionalInt(form, 'mdfeSerie');
    if (mdfeSerie !== undefined) configFields.mdfe_serie = mdfeSerie;

    const nfeUltimoNumero = readOptionalInt(form, 'nfeUltimoNumero');
    if (nfeUltimoNumero !== undefined) configFields.nfe_ultimo_numero = nfeUltimoNumero;
    const nfceUltimoNumero = readOptionalInt(form, 'nfceUltimoNumero');
    if (nfceUltimoNumero !== undefined) configFields.nfce_ultimo_numero = nfceUltimoNumero;
    const cteUltimoNumero = readOptionalInt(form, 'cteUltimoNumero');
    if (cteUltimoNumero !== undefined) configFields.cte_ultimo_numero = cteUltimoNumero;
    const mdfeUltimoNumero = readOptionalInt(form, 'mdfeUltimoNumero');
    if (mdfeUltimoNumero !== undefined) configFields.mdfe_ultimo_numero = mdfeUltimoNumero;

    const inscricaoMunicipal = readOptionalString(form, 'inscricaoMunicipal');
    if (inscricaoMunicipal !== undefined) configFields.inscricao_municipal = inscricaoMunicipal;
    const casasDecimais = readOptionalInt(form, 'casasDecimais');
    if (casasDecimais !== undefined) configFields.casas_decimais = casasDecimais;
    const cnpjAutorizado = readOptionalString(form, 'cnpjAutorizado');
    if (cnpjAutorizado !== undefined) configFields.cnpj_autorizado = cnpjAutorizado;
    const observacaoNfe = readOptionalString(form, 'observacaoNfe');
    if (observacaoNfe !== undefined) configFields.observacao_nfe = observacaoNfe;
    const observacaoPedido = readOptionalString(form, 'observacaoPedido');
    if (observacaoPedido !== undefined) configFields.observacao_pedido = observacaoPedido;

    // Identificação da empresa + endereço + padrões de impostos (migration
    // 025) — mesmo princípio acima, upsert parcial só com o que veio.
    const razaoSocial = readOptionalString(form, 'razaoSocial');
    if (razaoSocial !== undefined) configFields.razao_social = razaoSocial;
    const nomeFantasia = readOptionalString(form, 'nomeFantasia');
    if (nomeFantasia !== undefined) configFields.nome_fantasia = nomeFantasia;
    const tipoPessoa = readOptionalString(form, 'tipoPessoa');
    if (tipoPessoa === 'juridica' || tipoPessoa === 'fisica') configFields.tipo_pessoa = tipoPessoa;
    const inscricaoEstadual = readOptionalString(form, 'inscricaoEstadual');
    if (inscricaoEstadual !== undefined) configFields.inscricao_estadual = inscricaoEstadual;

    const enderecoLogradouro = readOptionalString(form, 'enderecoLogradouro');
    if (enderecoLogradouro !== undefined) configFields.endereco_logradouro = enderecoLogradouro;
    const enderecoNumero = readOptionalString(form, 'enderecoNumero');
    if (enderecoNumero !== undefined) configFields.endereco_numero = enderecoNumero;
    const enderecoComplemento = readOptionalString(form, 'enderecoComplemento');
    if (enderecoComplemento !== undefined) configFields.endereco_complemento = enderecoComplemento;
    const enderecoBairro = readOptionalString(form, 'enderecoBairro');
    if (enderecoBairro !== undefined) configFields.endereco_bairro = enderecoBairro;
    const enderecoCidade = readOptionalString(form, 'enderecoCidade');
    if (enderecoCidade !== undefined) configFields.endereco_cidade = enderecoCidade;
    const enderecoUf = readOptionalString(form, 'enderecoUf');
    if (enderecoUf !== undefined) configFields.endereco_uf = enderecoUf;
    const enderecoCep = readOptionalString(form, 'enderecoCep');
    if (enderecoCep !== undefined) configFields.endereco_cep = enderecoCep;

    const cstCsosnPadrao = readOptionalString(form, 'cstCsosnPadrao');
    if (cstCsosnPadrao !== undefined) configFields.cst_csosn_padrao = cstCsosnPadrao;
    const cstPisPadrao = readOptionalString(form, 'cstPisPadrao');
    if (cstPisPadrao !== undefined) configFields.cst_pis_padrao = cstPisPadrao;
    const cstCofinsPadrao = readOptionalString(form, 'cstCofinsPadrao');
    if (cstCofinsPadrao !== undefined) configFields.cst_cofins_padrao = cstCofinsPadrao;
    const cstIpiPadrao = readOptionalString(form, 'cstIpiPadrao');
    if (cstIpiPadrao !== undefined) configFields.cst_ipi_padrao = cstIpiPadrao;
    const fretePadrao = readOptionalString(form, 'fretePadrao');
    if (fretePadrao !== undefined) configFields.frete_padrao = fretePadrao;
    const tipoPagamentoPadrao = readOptionalString(form, 'tipoPagamentoPadrao');
    if (tipoPagamentoPadrao !== undefined) configFields.tipo_pagamento_padrao = tipoPagamentoPadrao;
    const naturezaOperacaoPadrao = readOptionalString(form, 'naturezaOperacaoPadrao');
    if (naturezaOperacaoPadrao !== undefined) configFields.natureza_operacao_padrao = naturezaOperacaoPadrao;

    if (Object.keys(configFields).length > 0) {
      const { error } = await supabaseAdmin.from('store_fiscal_config').upsert(
        { store_id: storeId, ...configFields, updated_at: new Date().toISOString() },
        { onConflict: 'store_id' }
      );
      if (error) throw new Error(error.message);
    }

    // CSC/CSCID (segredo compartilhado com a SEFAZ, mesma sensibilidade da
    // senha do certificado acima) — write-only, mesmo cuidado de só gravar
    // o que veio preenchido.
    const secretFields: Record<string, string> = {};

    const cscHomologacao = readOptionalString(form, 'cscHomologacao');
    if (cscHomologacao !== undefined) secretFields.csc_homologacao = cscHomologacao;
    const cscidHomologacao = readOptionalString(form, 'cscidHomologacao');
    if (cscidHomologacao !== undefined) secretFields.cscid_homologacao = cscidHomologacao;
    const cscProducao = readOptionalString(form, 'cscProducao');
    if (cscProducao !== undefined) secretFields.csc_producao = cscProducao;
    const cscidProducao = readOptionalString(form, 'cscidProducao');
    if (cscidProducao !== undefined) secretFields.cscid_producao = cscidProducao;

    if (Object.keys(secretFields).length > 0) {
      const { error } = await supabaseAdmin.from('store_fiscal_config_secrets').upsert(
        { store_id: storeId, ...secretFields, updated_at: new Date().toISOString() },
        { onConflict: 'store_id' }
      );
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { storeId } = await req.json();

  if (typeof storeId !== 'string' || !UUID_RE.test(storeId)) {
    return NextResponse.json({ success: false, message: 'storeId inválido.' }, { status: 400 });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: certFiles, error: listError } = await supabaseAdmin.storage.from(CERT_BUCKET).list(storeId);
    if (listError) {
      return NextResponse.json({ success: false, message: listError.message }, { status: 500 });
    }
    if (certFiles && certFiles.length > 0) {
      const paths = certFiles.map((f) => `${storeId}/${f.name}`);
      const { error: removeError } = await supabaseAdmin.storage.from(CERT_BUCKET).remove(paths);
      if (removeError) return NextResponse.json({ success: false, message: removeError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
