// Monta os parâmetros do XML da nota a partir da venda. Fonte ÚNICA usada pela emissão no servidor
// (app/api/fiscal/emitir/route.ts) e pela nota em contingência feita no próprio computador da loja sem
// internet (lib/fiscal/emitirOffline.ts, rodando no app do Windows) — as duas notas saem iguais.
import type { ItemNota, MontarXmlParams, PagamentoNota, DestinatarioNota } from './xml';
import { normalizarNcm } from './ncm';

export interface ConfigEmitenteVenda {
  ambiente: 'homologacao' | 'producao';
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

export interface ItemVenda {
  quantity: number;
  price_at_time: number | string;
  selected_options?: { name: string; omie_codigo?: string | null }[] | null;
  product?: { id?: string | null; name?: string | null; ncm?: string | null; omie_codigo?: string | null } | null;
}

export interface ProdutoTaxaVenda { name: string; omie_codigo: string | null; ncm: string | null }

export function itensDaVenda(itens: ItemVenda[]): ItemNota[] {
  return itens.map((i) => {
    const produto = i.product;
    // Descrição com a variação/adicional escolhido ("Pizza Calabresa (Grande)"), sem o R$ dos adicionais.
    const adicionais = i.selected_options || [];
    const nomeComVariacao = adicionais.length
      ? `${produto?.name ?? 'Produto'} (${adicionais.map((o) => o.name).join(', ')})`
      : (produto?.name ?? 'Produto');
    return {
      // omie_codigo é o SKU real; produto com variação usa o código da 1ª opção com código (o ImportarNFCe
      // do Omie recusa a nota se algum cProd não existir lá). UUID truncado só em último caso.
      cProd: produto?.omie_codigo || adicionais.find((o) => o.omie_codigo)?.omie_codigo || String(produto?.id ?? '').slice(0, 8),
      xProd: nomeComVariacao,
      ncm: normalizarNcm(produto?.ncm) ?? produto?.ncm ?? undefined,
      qCom: i.quantity,
      vUnCom: Number(i.price_at_time),
    } as ItemNota;
  });
}

export function montarParamsDaVenda(p: {
  config: ConfigEmitenteVenda;
  cnpjLoja: string;
  modelo: '55' | '65';
  serie: number;
  numero: number;
  itensXml: ItemNota[];
  produtoTaxa?: ProdutoTaxaVenda | null;
  destinatario?: DestinatarioNota;
  pagamentos?: PagamentoNota[];
}): MontarXmlParams {
  const { config } = p;
  return {
    taxaServico: p.produtoTaxa?.omie_codigo
      ? { cProd: String(p.produtoTaxa.omie_codigo), xProd: p.produtoTaxa.name, ncm: normalizarNcm(p.produtoTaxa.ncm) ?? p.produtoTaxa.ncm }
      : undefined,
    modelo: p.modelo,
    ambiente: config.ambiente,
    serie: p.serie,
    numero: p.numero,
    emitente: {
      // CNPJ real do emitente = stores.cnpj (validado contra o certificado), nunca cnpj_autorizado.
      cnpj: p.cnpjLoja,
      ie: config.inscricao_estadual || '',
      razaoSocial: config.razao_social || '',
      logradouro: config.endereco_logradouro || '',
      numero: config.endereco_numero || 'S/N',
      bairro: config.endereco_bairro || '',
      municipio: config.endereco_cidade || '',
      // TODO: mapear UF/município -> código IBGE quando expandir além da BA/Mata de São João.
      cMun: '2921005',
      uf: config.endereco_uf || 'BA',
      cep: (config.endereco_cep || '').replace(/\D/g, ''),
      cUF: 29,
      cstCsosnPadrao: config.cst_csosn_padrao || '102',
      cstPisPadrao: config.cst_pis_padrao || '07',
      cstCofinsPadrao: config.cst_cofins_padrao || '07',
      // <autXML> exigido na Bahia; sem escritório configurado, CNPJ da própria SEFAZ-BA (cStat=486 sem nenhum).
      autXmlCnpj: (config.cnpj_autorizado || '').replace(/\D/g, '') || '13937073000156',
      telefone: config.telefone || undefined,
    },
    itens: p.itensXml,
    destinatario: p.destinatario,
    pagamentos: p.pagamentos,
  };
}
