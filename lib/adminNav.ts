// lib/adminNav.ts — navegação da Administração como dado puro (sem React, sem I/O).
export type AreaId = 'vendas' | 'caixa' | 'cardapio' | 'equipe' | 'config';
export type AbaId =
  | 'dashboard' | 'sales' | 'relatorios' | 'excecoes'
  | 'shifts' | 'regras_caixa'
  | 'saude' | 'precos' | 'cupons' | 'link'
  | 'users' | 'permissoes'
  | 'settings' | 'impressao' | 'locais' | 'fiscal';
export type SecaoId = 'atendimento' | 'pedido_cliente' | 'notificacoes' | 'impressao' | 'aparencia' | 'aplicativo' | 'regras';

export interface AbaDef { id: AbaId; label: string; sensitive?: boolean }
export interface AreaDef { id: AreaId; label: string; descricao: string; abas: AbaDef[] }

export const AREAS: AreaDef[] = [
  { id: 'vendas', label: 'Vendas', descricao: 'O que a loja vendeu', abas: [
    { id: 'dashboard', label: 'Resumo' },
    { id: 'sales', label: 'Histórico' },
    { id: 'relatorios', label: 'Relatórios' },
    { id: 'excecoes', label: 'Exceções' },
  ] },
  { id: 'caixa', label: 'Caixa', descricao: 'Turnos e regras do caixa', abas: [
    { id: 'shifts', label: 'Turnos' },
    { id: 'regras_caixa', label: 'Regras do caixa' },
  ] },
  { id: 'cardapio', label: 'Cardápio', descricao: 'Saúde, preços, cupons e link', abas: [
    { id: 'saude', label: 'Saúde do cardápio' },
    { id: 'precos', label: 'Preço por horário' },
    { id: 'cupons', label: 'Cupons' },
    { id: 'link', label: 'Link e QR code' },
  ] },
  { id: 'equipe', label: 'Equipe', descricao: 'Pessoas e o que cada função pode', abas: [
    { id: 'users', label: 'Pessoas' },
    { id: 'permissoes', label: 'Permissões' },
  ] },
  { id: 'config', label: 'Configurações', descricao: 'Atendimento, impressão e notas', abas: [
    { id: 'settings', label: 'Geral' },
    { id: 'impressao', label: 'Impressão' },
    { id: 'locais', label: 'Locais de preparo' },
    { id: 'fiscal', label: 'Notas fiscais', sensitive: true },
  ] },
];

// Abas cujas telas ainda não estão ligadas; vazio: Saúde e Permissões estão ligadas.
export const ABAS_EM_BREVE = new Set<AbaId>();

export interface NavCtx {
  user: { role: string };
  podeVerExcecoes: boolean;
  can?: (acao: 'editar_cardapio' | 'editar_precos_horario' | 'ver_permissoes') => boolean;
}

const EXIGE: Partial<Record<AbaId, (c: NavCtx) => boolean>> = {
  excecoes: (c) => c.podeVerExcecoes,
  saude: (c) => (c.can ? c.can('editar_cardapio') : true),
  precos: (c) => (c.can ? c.can('editar_precos_horario') : true),
  permissoes: (c) => (c.can ? c.can('ver_permissoes') : true),
};

export function abasVisiveis(ctx: NavCtx): Set<AbaId> {
  const out = new Set<AbaId>();
  AREAS.forEach((a) => a.abas.forEach((b) => {
    if (ABAS_EM_BREVE.has(b.id)) return;
    const ok = EXIGE[b.id];
    if (!ok || ok(ctx)) out.add(b.id);
  }));
  return out;
}

export function areasVisiveis(ctx: NavCtx): AreaDef[] {
  const v = abasVisiveis(ctx);
  return AREAS.map((a) => ({ ...a, abas: a.abas.filter((b) => v.has(b.id)) })).filter((a) => a.abas.length > 0);
}

export function areaDaAba(id: AbaId): AreaId {
  return AREAS.find((a) => a.abas.some((b) => b.id === id))!.id;
}

export function abaInicial(area: AreaId, ctx: NavCtx): AbaId | null {
  return areasVisiveis(ctx).find((a) => a.id === area)?.abas[0]?.id ?? null;
}

export function corrigirAba(atual: AbaId, ctx: NavCtx): AbaId {
  if (abasVisiveis(ctx).has(atual)) return atual;
  return areasVisiveis(ctx)[0]?.abas[0]?.id ?? 'dashboard';
}

export interface Ajuste { id: string; titulo: string; descricao: string; secao: SecaoId; aba: AbaId; palavras: string[] }

export const AJUSTES: Ajuste[] = [
  { id: 'client_ordering', titulo: 'Clientes podem fazer pedido pelo celular', descricao: 'Liga ou desliga o pedido pelo QR da mesa; desligado, o cardápio vira só consulta.', secao: 'pedido_cliente', aba: 'settings', palavras: ['qr', 'cardapio', 'vitrine', 'cliente', 'pin'] },
  { id: 'pedido_pede_senha', titulo: 'Pedir a senha de quem lança o pedido', descricao: 'A cada pedido de mesa o garçom digita a própria senha e o pedido sai no nome dele.', secao: 'atendimento', aba: 'settings', palavras: ['garcom', 'login', 'operador'] },
  { id: 'notificacoes', titulo: 'Notificações do painel', descricao: 'Som e quais avisos cada função recebe no sino.', secao: 'notificacoes', aba: 'settings', palavras: ['sino', 'aviso', 'alerta', 'som'] },
  { id: 'taxa_servico', titulo: 'Cobrar taxa de serviço', descricao: 'Soma a taxa de serviço na conta das mesas.', secao: 'atendimento', aba: 'settings', palavras: ['10%', 'gorjeta', 'servico'] },
  { id: 'contagem_cega', titulo: 'Contagem cega no fechamento de caixa', descricao: 'O operador conta o dinheiro sem ver o valor esperado.', secao: 'regras', aba: 'regras_caixa', palavras: ['fechamento', 'turno', 'dinheiro'] },
  { id: 'mais_vendidos', titulo: 'Mostrar mais vendidos automaticamente no cardápio', descricao: 'Marca com um selo os produtos que mais saíram nos últimos 30 dias.', secao: 'pedido_cliente', aba: 'settings', palavras: ['destaque', 'popular', 'selo'] },
  { id: 'largura_papel', titulo: 'Largura do papel da impressora', descricao: 'Escolha 48, 58 ou 80 mm conforme a bobina.', secao: 'impressao', aba: 'settings', palavras: ['bobina', 'termica', 'comanda', 'mm'] },
  { id: 'avisos_tempo', titulo: 'Avisos de tempo na gestão de mesas', descricao: 'Minutos para a mesa ficar em alerta por demora ou sem pedido.', secao: 'atendimento', aba: 'settings', palavras: ['alerta', 'demora', 'minutos', 'mesa'] },
  { id: 'tolerancia_caixa', titulo: 'Tolerância no fechamento de caixa', descricao: 'Diferença acima do valor exige aprovação de um supervisor para fechar o turno.', secao: 'regras', aba: 'regras_caixa', palavras: ['diferenca', 'supervisor', 'quebra'] },
  { id: 'alerta_sangria', titulo: 'Alertar sangria acima de', descricao: 'Sangria igual ou maior que o valor gera um registro de auditoria.', secao: 'regras', aba: 'regras_caixa', palavras: ['retirada', 'auditoria', 'valor'] },
  { id: 'cor_destaque', titulo: 'Cor de destaque da tela de identificação', descricao: 'Cor da marca da loja na tela em que o cliente se identifica.', secao: 'aparencia', aba: 'settings', palavras: ['marca', 'azul', 'tema'] },
  { id: 'identidade_visual', titulo: 'Identidade visual do cardápio', descricao: 'Escolha o estilo do cardápio que o cliente vê.', secao: 'aparencia', aba: 'settings', palavras: ['tema', 'estilo', 'visual', 'preset'] },
  { id: 'observacoes_rapidas', titulo: 'Sugestões de observação rápida', descricao: 'Atalhos de texto para o cliente anotar no pedido (ex.: sem cebola).', secao: 'pedido_cliente', aba: 'settings', palavras: ['nota', 'observacao', 'atalho', 'chips'] },
  { id: 'capa_cardapio', titulo: 'Imagem de capa do cardápio', descricao: 'Foto do topo do cardápio do cliente (paisagem, ideal 1200x600).', secao: 'aparencia', aba: 'settings', palavras: ['foto', 'banner', 'hero'] },
  { id: 'baixar_app', titulo: 'Baixar o aplicativo', descricao: 'Instaladores do Norte Vendas para o computador e o celular.', secao: 'aplicativo', aba: 'settings', palavras: ['download', 'desktop', 'apk', 'instalar'] },
];

export const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function buscarAjustes(q: string, lista: Ajuste[] = AJUSTES): Ajuste[] {
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const pontuados = lista.map((a, i) => {
    const t = norm(a.titulo), p = a.palavras.map(norm).join(' '), d = norm(a.descricao);
    let score = 0;
    for (const tk of tokens) {
      const s = (t.includes(tk) ? 3 : 0) + (p.includes(tk) ? 2 : 0) + (d.includes(tk) ? 1 : 0);
      if (s === 0) return { a, score: 0, i };
      score += s;
    }
    return { a, score, i };
  });
  return pontuados.filter((x) => x.score > 0).sort((x, y) => y.score - x.score || x.i - y.i).map((x) => x.a);
}
