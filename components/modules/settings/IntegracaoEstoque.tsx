'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Button, Badge } from '@/components/ui';
import { toast } from '@/components/Toast';
import { usePolling } from '@/lib/usePolling';
import { resolverUrlApi, fetchIntegracaoBaixas, acaoBaixaEstoque, type BaixaEstoque, type BaixasEstoqueResumo } from '@/lib/api';
import { MAX_TENTATIVAS } from '@/lib/baixaEstoque';
import type { ResumoConexao } from '@/lib/estoqueConexao';

// Administração > Configurações > Integrações: estado REAL da ligação com o NTB Estoque (não só "tem chave salva") e as baixas de
// estoque que não fecharam. Tudo vem do servidor (a chave nunca vem para o navegador).

export type TesteConexao = { configurado: boolean; ativo?: boolean } & Partial<ResumoConexao>;

export function useConexaoEstoque(storeId: string, configurado: boolean) {
    const [teste, setTeste] = useState<TesteConexao | null>(null);
    const [testando, setTestando] = useState(false);
    const seq = useRef(0);
    const testar = useCallback(async () => {
        const minha = ++seq.current;
        setTestando(true);
        try {
            const res = await fetch(resolverUrlApi(`/api/integracao/testar-conexao?storeId=${encodeURIComponent(storeId)}`), { cache: 'no-store' });
            const json = (await res.json()) as TesteConexao;
            if (minha === seq.current) setTeste(json);
        } catch {
            if (minha === seq.current) setTeste({ configurado: true, estado: 'fora_do_ar', mensagem: 'Não foi possível testar agora (sem internet?).' });
        } finally {
            if (minha === seq.current) setTestando(false);
        }
    }, [storeId]);
    // Configurada: testa sozinho ao abrir a tela (assim "Configurado" nunca é só "tem uma chave salva").
    useEffect(() => { if (configurado) void testar(); else setTeste(null); }, [configurado, testar]);
    return { teste, testando, testar };
}

/** Selo do título do cartão. Só fica verde quando a chave respondeu e a loja do Estoque é real. */
export function SeloConexao({ configurado, teste, testando }: { configurado: boolean; teste: TesteConexao | null; testando: boolean }) {
    if (!configurado) return null;
    if (!teste) return <Badge dot>{testando ? 'Testando…' : 'Não testado'}</Badge>;
    if (teste.estado !== 'ok') return <Badge variant="warning" dot>{teste.estado === 'chave_invalida' ? 'Chave recusada' : 'Sem conexão'}</Badge>;
    if (teste.simulada) return <Badge variant="warning" dot>Modo teste</Badge>;
    if (teste.versaoAntiga) return <Badge dot>Conexão ok</Badge>;
    if (teste.omieReal === false) return <Badge variant="warning" dot>Sem chave do Omie</Badge>;
    return <Badge variant="success" dot>Conectado</Badge>;
}

export const PainelConexao: React.FC<{ configurado: boolean; ativo: boolean; teste: TesteConexao | null; testando: boolean; onTestar: () => void }> = ({ configurado, ativo, teste, testando, onTestar }) => {
    if (!configurado) return null;
    const falhou = !!teste && teste.estado !== 'ok';
    const modoTeste = teste?.estado === 'ok' && teste.simulada === true;
    const aviso = falhou || modoTeste || (teste?.estado === 'ok' && (teste.versaoAntiga || teste.omieReal === false));
    return (
        <div data-testid="painel-conexao" className={`p-4 rounded-[var(--r-md)] ${falhou ? 'bg-[var(--err)]/10' : aviso ? 'bg-[var(--warn)]/10' : 'bg-[var(--surface-2)]'}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    {modoTeste && <p className="text-[14px] font-semibold text-[var(--warn)]">MODO TESTE — nada vai para o Omie real</p>}
                    {!modoTeste && (
                        <p className="text-sm text-[var(--text)]">
                            {!teste ? (testando ? 'Testando a conexão com o Estoque…' : 'Conexão ainda não testada.') : teste.mensagem}
                        </p>
                    )}
                    {modoTeste && <p className="text-sm text-[var(--text)]">A chave responde. As ordens de produção e saídas desta loja são simuladas no Estoque.</p>}
                    {teste?.estado === 'ok' && teste.nome && <p className="text-xs text-[var(--text-muted)] mt-0.5">Loja do Estoque: {teste.nome}{teste.locais ? ` · ${teste.locais} locais de estoque` : ''}</p>}
                    {teste?.estado === 'ok' && !ativo && <p className="text-xs text-[var(--text-muted)] mt-0.5">A integração está desativada: nenhuma venda baixa no Estoque.</p>}
                </div>
                <Button variant="outline" size="sm" onClick={onTestar} isLoading={testando}>Testar conexão</Button>
            </div>
        </div>
    );
};

const STATUS_ROTULO: Record<BaixaEstoque['status'], { texto: string; variante: 'default' | 'warning' | 'critical' }> = {
    pending: { texto: 'Enviando', variante: 'default' },
    erro: { texto: 'Com erro', variante: 'critical' },
    parcial: { texto: 'Parcial', variante: 'critical' },
    incerto: { texto: 'Conferir no Estoque', variante: 'warning' },
};

const quando = (iso: string) => { try { return format(new Date(iso), 'dd/MM HH:mm'); } catch { return ''; } };

export const BaixasEstoque: React.FC<{ storeId: string; podeAgir: boolean; operador: string; onResumo?: (r: BaixasEstoqueResumo | null) => void }> = ({ storeId, podeAgir, operador, onResumo }) => {
    const [resumo, setResumo] = useState<BaixasEstoqueResumo | null>(null);
    const [falhaLeitura, setFalhaLeitura] = useState(false);
    const [agindo, setAgindo] = useState<string | null>(null);
    const onResumoRef = useRef(onResumo);
    onResumoRef.current = onResumo;

    const carregar = useCallback(async () => {
        try {
            const r = await fetchIntegracaoBaixas(storeId);
            setResumo(r); setFalhaLeitura(false); onResumoRef.current?.(r);
        } catch { setFalhaLeitura(true); }
    }, [storeId]);
    useEffect(() => { void carregar(); }, [carregar]);
    usePolling(carregar, 30000);

    const agir = async (b: BaixaEstoque, acao: 'reprocessar' | 'conferir') => {
        setAgindo(`${b.id}:${acao}`);
        const r = await acaoBaixaEstoque(storeId, b.id, acao, operador);
        setAgindo(null);
        if (r.success) toast.success(acao === 'conferir' ? 'Baixa conferida.' : r.status === 'ok' ? 'Baixa enviada ao Estoque.' : 'Reenviada, mas ainda há item com problema.');
        else toast.error(r.message || 'Não foi possível concluir.');
        await carregar();
    };

    const itensProblema = (b: BaixaEstoque) => (b.resultado ?? []).map((r, i) => ({ r, i })).filter(({ r }) => !r || r.status !== 'ok');
    const podeRetentar = (b: BaixaEstoque) => b.status !== 'pending' && (b.resultado ?? []).some((r) => r && r.status === 'erro' && r.retentavel);
    const podeConferir = (b: BaixaEstoque) => (b.resultado ?? []).some((r) => r && r.status === 'incerto');

    return (
        <div className="space-y-3" data-testid="baixas-estoque">
            <p className="text-sm text-[var(--text-muted)]">
                Cada venda manda uma baixa para o Estoque. Se algo não chegar, aparece aqui; o que o sistema consegue reenviar com segurança ele reenvia sozinho.
            </p>
            <p className="text-[15px] font-semibold text-[var(--text)]" data-testid="baixas-resumo">
                {!resumo ? (falhaLeitura ? 'Baixas de estoque: não foi possível ler agora' : 'Baixas de estoque: carregando…')
                    : `Baixas de estoque: ${resumo.pendentes} pendente${resumo.pendentes === 1 ? '' : 's'}, ${resumo.com_erro} com erro`}
            </p>
            {resumo && resumo.itens.length === 0 && (
                <p className="text-sm text-[var(--text-muted)] p-4 bg-[var(--surface-2)] rounded-[var(--r-md)]">Nenhuma baixa com problema. Tudo o que foi vendido chegou ao Estoque.</p>
            )}
            <ul className="space-y-2">
                {(resumo?.itens ?? []).map((b) => {
                    const rotulo = STATUS_ROTULO[b.status];
                    return (
                        <li key={b.id} data-testid="baixa-linha" className="p-4 bg-[var(--surface-2)] rounded-[var(--r-md)] space-y-2">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2 flex-wrap min-w-0">
                                    <span className="font-semibold text-[15px] text-[var(--text)]">{b.rotulo || 'Pedido'}</span>
                                    <span className="text-xs text-[var(--text-muted)] num">{quando(b.created_at)} · #{b.order_id.slice(0, 8)}</span>
                                </div>
                                <Badge variant={rotulo.variante === 'critical' ? 'critical' : rotulo.variante === 'warning' ? 'warning' : 'default'}>{rotulo.texto}</Badge>
                            </div>
                            <ul className="space-y-1">
                                {itensProblema(b).map(({ r, i }) => (
                                    <li key={i} className="text-sm text-[var(--text)]">
                                        <span className="font-medium">{r?.codigo ?? 'Item'}</span>
                                        <span className="text-[var(--text-muted)]"> — {r ? (r.erro || r.detalhe || 'falha') : 'aguardando envio'}</span>
                                        {r?.status === 'incerto' && r.detalhe && r.erro ? <span className="block text-xs text-[var(--text-muted)]">{r.detalhe}</span> : null}
                                    </li>
                                ))}
                            </ul>
                            {(b.status === 'erro' || b.status === 'parcial') && (
                                <p className="text-xs text-[var(--text-muted)]">
                                    {b.tentativas >= MAX_TENTATIVAS ? `O sistema parou de tentar sozinho (${b.tentativas} tentativas). Corrija a causa e use "Tentar de novo".` : `Tentativa ${b.tentativas} de ${MAX_TENTATIVAS}: o sistema tenta de novo sozinho.`}
                                </p>
                            )}
                            {b.status === 'incerto' && <p className="text-xs text-[var(--text-muted)]">Pode já ter sido baixado no Estoque. Reenviar poderia duplicar a ordem de produção, por isso o sistema não reenvia sozinho: confira lá.</p>}
                            {podeAgir ? (
                                <div className="flex gap-2 flex-wrap pt-1">
                                    {podeRetentar(b) && <Button size="sm" variant="secondary" isLoading={agindo === `${b.id}:reprocessar`} onClick={() => agir(b, 'reprocessar')}>Tentar de novo</Button>}
                                    {podeConferir(b) && <Button size="sm" variant="outline" isLoading={agindo === `${b.id}:conferir`} onClick={() => agir(b, 'conferir')}>Já conferi no Estoque</Button>}
                                </div>
                            ) : (podeRetentar(b) || podeConferir(b)) && <p className="text-xs text-[var(--text-muted)]">Só o gerente ou o dono pode agir aqui.</p>}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};
