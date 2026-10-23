// Sessão do cliente no cardápio (/c/[slug]) guardada em localStorage (`session_${slug}`).
//
// 22/10/2026 (reunião de 21/10): pediram na mesa 1 e, depois, "entrei na mesa 2 com outro login e ele entrou
// como se estivesse continuando a compra". O QR é o MESMO link para todas as mesas; cada leitura abre uma aba nova,
// que restaurava sozinha a sessão salva (mesa 1, até 4 h) e, desde c6050c4, o "Confirmar" com sessão aberta enviava
// direto para essa mesa sem perguntar nada. Duas regras aqui:
// 1) a sessão salva só volta se a mesa ainda é a MESMA ocupação (anfitrião igual ao do login); mesa fechada e
//    reaberta por outro grupo descarta a sessão, para os pedidos desse grupo nunca aparecerem para quem já foi;
// 2) sessão restaurada pede uma confirmação ("vai para a Mesa N, em nome de X?") no primeiro envio da página.

export type SessaoSalva = {
    name: string;
    tableId: string | null;
    mode: 'table' | 'counter';
    timestamp: number;
    hostPin?: string | null;
    // Anfitrião da mesa no momento do login (identifica ESTA ocupação). Ausente em sessões gravadas antes de 22/10.
    hostName?: string | null;
};

export const SESSAO_VALIDADE_MS = 4 * 60 * 60 * 1000;

export function lerSessaoSalva(raw: string | null): SessaoSalva | null {
    if (!raw) return null;
    try {
        const s = JSON.parse(raw);
        if (!s || typeof s !== 'object' || typeof s.name !== 'string' || typeof s.timestamp !== 'number') return null;
        return s as SessaoSalva;
    } catch {
        return null;
    }
}

const normalizarNome = (n: string | null | undefined) => (n ?? '').trim().toLowerCase();

type MesaAtual = { status: string; current_host_name?: string | null } | null | undefined;

// 'restaurar' = pode voltar (com confirmação no 1º envio); 'descartar' = apagar do aparelho.
export function decidirRestauracao(s: SessaoSalva, mesa: MesaAtual, agora: number): 'restaurar' | 'descartar' {
    if (agora - s.timestamp >= SESSAO_VALIDADE_MS) return 'descartar';
    if (!s.tableId) return s.mode === 'counter' ? 'restaurar' : 'descartar';
    if (!mesa || (mesa.status !== 'occupied' && mesa.status !== 'waiting_bill')) return 'descartar';
    // Sessão nova (com hostName gravado): anfitrião diferente = a mesa foi fechada e reaberta por outra pessoa.
    if ('hostName' in s && normalizarNome(s.hostName) !== normalizarNome(mesa.current_host_name)) return 'descartar';
    return 'restaurar';
}

export function montarSessaoSalva(p: {
    name: string;
    tableId: string | null;
    hostPin: string | null;
    hostName: string | null;
    agora: number;
}): SessaoSalva {
    return {
        name: p.name,
        tableId: p.tableId,
        mode: p.tableId ? 'table' : 'counter',
        timestamp: p.agora,
        hostPin: p.tableId ? p.hostPin : null,
        hostName: p.tableId ? p.hostName : null,
    };
}

// Texto da confirmação mostrada no 1º envio de uma sessão restaurada.
export function textoConfirmarSessao(nome: string, mesa: number | null): { title: string; message: string; confirmLabel: string; cancelLabel: string } {
    const onde = mesa != null ? `Mesa ${mesa}` : 'Balcão';
    return {
        title: mesa != null ? `Enviar para a Mesa ${mesa}?` : 'Enviar como pedido no balcão?',
        message: `Este aparelho ainda está identificado como ${nome} (${onde}). Se você está em outra mesa ou é outra pessoa, toque em "Estou em outra mesa" e identifique-se de novo; seu carrinho continua aqui.`,
        confirmLabel: `Sim, ${onde}`,
        cancelLabel: 'Estou em outra mesa',
    };
}
