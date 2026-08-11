import { montarChaveAcesso } from './chaveAcesso';

export interface ItemNota {
  cProd: string; // código do produto (pode ser o id truncado ou omie_codigo)
  xProd: string; // descrição
  ncm: string;
  qCom: number;
  vUnCom: number;
  cfop?: string; // default 5102
}

export interface DestinatarioNota {
  cpfCnpj: string;
  nome: string;
}

export interface DadosEmitenteNota {
  cnpj: string;
  ie: string;
  razaoSocial: string;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  cMun: string; // código IBGE
  uf: string;
  cep: string;
  cUF: number; // código IBGE da UF (29 = BA)
  cstCsosnPadrao: string;
  cstPisPadrao: string;
  cstCofinsPadrao: string;
  autXmlCnpj?: string; // exigência específica da BA — CNPJ do escritório de contabilidade
  telefone?: string; // opcional — schema NFe aceita <fone> ausente
}

export interface MontarXmlParams {
  modelo: '55' | '65';
  ambiente: 'homologacao' | 'producao';
  serie: number;
  numero: number;
  emitente: DadosEmitenteNota;
  itens: ItemNota[];
  destinatario?: DestinatarioNota; // obrigatório pra modelo 55, ausente pra 65
}

// Texto obrigatório em homologação (SEFAZ rejeita sem isso). Pra NFC-e (sem
// <dest>), vai no xProd do primeiro item; pra NF-e, no xNome do <dest> — ver
// histórico em AGENTS.md (2026-08-04) sobre qual campo é o certo pra cada modelo.
const AVISO_HOMOLOGACAO = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

// Variante pro <dest>/xNome de NF-e: esse campo tem limite de 60 caracteres
// no schema (diferente do xProd, que tem 120) — a frase acima sozinha já
// tem 65, estouraria o limite mesmo sem concatenar o nome do cliente. Texto
// exato (58 caracteres) é a convenção padrão usada pelas bibliotecas/SEFAZ
// pra esse campo especificamente. Achado real no Task 18 (2026-08-06):
// REPLACE, não append — ver comentário no uso abaixo.
const AVISO_HOMOLOGACAO_XNOME = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

// Escapa entidades XML obrigatórias em qualquer valor de texto livre
// interpolado nos templates abaixo — achado da revisão final de branch
// (2026-08-06): nome de produto com "&" (ex.: "Fish & Chips", comum em
// cardápio) gerava XML malformado, e isso só quebra DEPOIS de
// increment_fiscal_numero_secure já ter consumido um número fiscal real
// (xml-crypto lança ao tentar assinar um XML inválido, ou a SEFAZ rejeita
// por erro de schema). Mesma lição já registrada em lib/print.ts/AGENTS.md
// (incidente de XSS armazenado por falta de escape) — só não tinha sido
// replicada aqui ainda.
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// xProd tem limite de 120 caracteres no schema da NFe/NFC-e (contando o
// texto decodificado, não os bytes com entidade escapada).
const XPROD_MAX = 120;

// Achado real no Task 18 (2026-08-06): a SEFAZ REJEITA (cStat=373,
// "Descricao do primeiro item diferente de NOTA FISCAL EMITIDA EM AMBIENTE
// DE HOMOLOGACAO - SEM VALOR FISCAL") se o xProd do primeiro item da NFC-e
// em homologação for o nome do produto CONCATENADO com o aviso — a
// validação exige o texto EXATO, sem nada antes ou depois. Mesma convenção
// de REPLACE (não append) já corrigida pro <dest>/xNome de NF-e acima,
// confirmada ao vivo desta vez pela própria mensagem de rejeição da SEFAZ
// (não é suposição). A versão antiga deste comentário dizia "ganha o aviso
// concatenado" — estava errada, corrigido aqui.
function montarXProd(nomeProduto: string, comAvisoHomologacao: boolean): string {
  if (comAvisoHomologacao) return escapeXml(AVISO_HOMOLOGACAO);
  return escapeXml(nomeProduto.slice(0, XPROD_MAX));
}

// Componentes de data/hora sempre resolvidos em America/Sao_Paulo, nunca a
// partir do horário local do processo Node — achado crítico da revisão
// final de branch (2026-08-06): em dev o servidor já roda com o relógio do
// SO em UTC-3 (Brasil), então `now.getHours()`/etc "pareciam" corretos; na
// Vercel o runtime é UTC, e o código antigo lia um relógio UTC e rotulava
// como "-03:00" — carimbando toda nota ~3h no futuro. A SEFAZ tem
// tolerância apertada pra dhEmi no futuro e rejeita (cStat=703), o que
// quebraria essencialmente 100% das emissões reais em produção sem nunca
// aparecer em teste local. O Brasil não observa mais horário de verão em
// nenhum estado desde 2019, então o offset "-03:00" é fixo o ano inteiro
// pra Bahia (única UF usada hoje neste projeto) — não precisamos calcular
// o offset dinamicamente, só garantir que os COMPONENTES (ano/mês/dia/
// hora/min/seg) venham do fuso certo, não do relógio cru do processo.
// Verificado com `TZ=UTC node -e "..."` simulando o runtime da Vercel,
// inclusive o caso de virada de dia/mês/ano (ex.: 2026-01-01 02:30 UTC =
// 2025-12-31 23:30 em São Paulo) — os componentes saem corretos.
function componentesSaoPaulo(now: Date) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '00';
  return {
    ano: get('year'),
    mes: get('month'),
    dia: get('day'),
    hora: get('hour'),
    minuto: get('minute'),
    segundo: get('second'),
  };
}

export function montarXmlNota(params: MontarXmlParams): { xml: string; chave: string; infNFeId: string } {
  const { modelo, ambiente, serie, numero, emitente, itens, destinatario } = params;
  if (!itens.length) throw new Error('Nota sem itens.');
  if (modelo === '55' && !destinatario) throw new Error('NF-e (modelo 55) exige destinatário.');

  const tpAmb = ambiente === 'homologacao' ? 2 : 1;
  const now = new Date();
  const { ano, mes, dia, hora, minuto, segundo } = componentesSaoPaulo(now);
  const anoMes = ano.slice(2) + mes;

  const { chave, cNF } = montarChaveAcesso({
    cUF: emitente.cUF,
    anoMes,
    cnpj: emitente.cnpj,
    modelo,
    serie,
    numero,
  });

  const dhEmi = `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}-03:00`;

  const infNFeId = `NFe${chave}`;

  let vProdTotal = 0;
  const detXml = itens
    .map((item, i) => {
      const vProd = Number((item.qCom * item.vUnCom).toFixed(2));
      vProdTotal += vProd;
      const xProd = montarXProd(item.xProd, tpAmb === 2 && i === 0 && modelo === '65');
      return (
        `<det nItem="${i + 1}"><prod><cProd>${escapeXml(item.cProd)}</cProd><cEAN>SEM GTIN</cEAN><xProd>${xProd}</xProd>` +
        `<NCM>${item.ncm}</NCM><CFOP>${item.cfop ?? '5102'}</CFOP><uCom>UN</uCom>` +
        `<qCom>${item.qCom.toFixed(4)}</qCom><vUnCom>${item.vUnCom.toFixed(10)}</vUnCom>` +
        `<vProd>${vProd.toFixed(2)}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib>` +
        `<qTrib>${item.qCom.toFixed(4)}</qTrib><vUnTrib>${item.vUnCom.toFixed(10)}</vUnTrib><indTot>1</indTot></prod>` +
        `<imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>${emitente.cstCsosnPadrao}</CSOSN></ICMSSN102></ICMS>` +
        `<PIS><PISNT><CST>${emitente.cstPisPadrao}</CST></PISNT></PIS>` +
        `<COFINS><COFINSNT><CST>${emitente.cstCofinsPadrao}</CST></COFINSNT></COFINS></imposto></det>`
      );
    })
    .join('');

  const destXml = destinatario
    ? (() => {
        const doc = destinatario.cpfCnpj.replace(/\D/g, '');
        const tagDoc = doc.length === 14 ? 'CNPJ' : 'CPF';
        // Achado da revisão final de branch (2026-08-06), confirmado ao
        // testar de verdade no Task 18: a convenção correta da SEFAZ pra
        // homologação de NF-e é SUBSTITUIR xNome do destinatário pelo aviso
        // fixo, não concatenar com o nome real — diferente da NFC-e (sem
        // <dest>), que usa o xProd do primeiro item pra isso (ver acima).
        // A versão antiga concatenava `${nome} - ${AVISO_HOMOLOGACAO}` sem
        // truncar, estourando o limite de 60 caracteres do schema (o aviso
        // de xProd sozinho já tem 65) e rejeitando com cStat=225 "Falha no
        // Schema XML" antes mesmo de chegar em regra de negócio.
        const xNome = escapeXml(tpAmb === 2 ? AVISO_HOMOLOGACAO_XNOME : destinatario.nome);
        // Achado real no Task 18 (2026-08-06): a SEFAZ-BA (infra própria,
        // usada pro modelo 55 — ver lib/fiscal/soap.ts) rejeita com
        // cStat=719 "NF-e sem a identificação do destinatario" um <dest>
        // SEM <enderDest>, mesmo com CNPJ/CPF+xNome corretamente
        // preenchidos — apesar do texto da mensagem sugerir "identificação"
        // genérica, na prática é especificamente a ausência de endereço (a
        // doc nacional documenta um cStat=726 mais específico pra esse
        // caso, mas a SEFAZ-BA não usa ele aqui — mesma classe de
        // divergência de UF já registrada em AGENTS.md pro cStat=495).
        // Confirmado ao vivo: o MESMO XML, só acrescido de <enderDest>,
        // autoriza (cStat=100). Como `DestinatarioNota` não captura endereço
        // real do cliente (limitação conhecida, documentada em AGENTS.md —
        // era considerada só um problema de geração de DANFE, agora sabemos
        // que também bloqueia a TRANSMISSÃO em si pra SEFAZ-BA/modelo 55),
        // usamos o endereço do próprio EMITENTE como placeholder
        // fictício — mesmo princípio de "obviamente fictício mas
        // schema-válido" já usado no aviso de homologação: preenche o
        // requisito estrutural sem inventar um endereço que pareça real, e
        // usa um cMun (código IBGE) que já sabemos válido, evitando o risco
        // de um município inventado gerar uma rejeição nova.
        const enderDestXml =
          `<enderDest><xLgr>${escapeXml(emitente.logradouro)}</xLgr><nro>${escapeXml(emitente.numero)}</nro>` +
          `<xBairro>${escapeXml(emitente.bairro)}</xBairro><cMun>${emitente.cMun}</cMun>` +
          `<xMun>${escapeXml(emitente.municipio)}</xMun><UF>${emitente.uf}</UF><CEP>${emitente.cep}</CEP>` +
          `<cPais>1058</cPais><xPais>BRASIL</xPais></enderDest>`;
        return `<dest><${tagDoc}>${doc}</${tagDoc}><xNome>${xNome}</xNome>${enderDestXml}<indIEDest>9</indIEDest></dest>`;
      })()
    : '';

  // autXML antes de det (ordem do schema — ver AGENTS.md, "autXML depois de
  // pag dá cStat=225 Falha no Schema XML"). Só entra se a loja configurou um
  // CNPJ de escritório de contabilidade; senão a BA aceita sem esse grupo
  // pra quem não é obrigado (confirmar caso a caso — ver cStat=486 no histórico).
  const autXmlXml = emitente.autXmlCnpj ? `<autXML><CNPJ>${emitente.autXmlCnpj}</CNPJ></autXML>` : '';

  const vNF = vProdTotal.toFixed(2);

  const nfeXml =
    `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="${infNFeId}" versao="4.00">` +
    `<ide><cUF>${emitente.cUF}</cUF><cNF>${cNF}</cNF><natOp>VENDA AO CONSUMIDOR</natOp><mod>${modelo}</mod>` +
    `<serie>${serie}</serie><nNF>${numero}</nNF><dhEmi>${dhEmi}</dhEmi><tpNF>1</tpNF>` +
    `<idDest>${destinatario ? 1 : 1}</idDest><cMunFG>${emitente.cMun}</cMunFG>` +
    `<tpImp>${modelo === '65' ? 4 : 1}</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV>` +
    `<tpAmb>${tpAmb}</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres>` +
    `<procEmi>0</procEmi><verProc>ntb-vendas-1.0</verProc></ide>` +
    `<emit><CNPJ>${emitente.cnpj}</CNPJ><xNome>${escapeXml(emitente.razaoSocial)}</xNome>` +
    `<enderEmit><xLgr>${escapeXml(emitente.logradouro)}</xLgr><nro>${escapeXml(emitente.numero)}</nro><xBairro>${escapeXml(emitente.bairro)}</xBairro>` +
    `<cMun>${emitente.cMun}</cMun><xMun>${escapeXml(emitente.municipio)}</xMun><UF>${emitente.uf}</UF><CEP>${emitente.cep}</CEP>` +
    `<cPais>1058</cPais><xPais>BRASIL</xPais>` +
    (emitente.telefone ? `<fone>${emitente.telefone.replace(/\D/g, '')}</fone>` : '') +
    `</enderEmit><IE>${emitente.ie}</IE><CRT>1</CRT></emit>` +
    destXml +
    autXmlXml +
    detXml +
    `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP>` +
    `<vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${vNF}</vProd>` +
    `<vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI>` +
    `<vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro>` +
    `<vNF>${vNF}</vNF></ICMSTot></total><transp><modFrete>9</modFrete></transp>` +
    `<pag><detPag><indPag>0</indPag><tPag>01</tPag><vPag>${vNF}</vPag></detPag></pag>` +
    // Grupo opcional pelo schema, mas exigido na prática por `nfe-danfe-pdf`
    // (lib/fiscal/pdf.ts) — sem ele, a lib quebra tentando ler
    // `infAdic.infCpl` de um `infAdic` undefined. Vazio por padrão; dá pra
    // usar de verdade no futuro (ex.: "Volte sempre!").
    `<infAdic><infCpl></infCpl></infAdic>` +
    `</infNFe></NFe>`;

  return { xml: nfeXml, chave, infNFeId };
}
