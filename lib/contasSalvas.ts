// Contas salvas na tela de entrada do app desktop: quem já entrou neste
// computador vira um cartão ("Quem está entrando?"). A senha só é guardada
// se a pessoa marcar "entrar sem senha", e sempre criptografada pelo sistema
// operacional (safeStorage do Electron) — nunca em texto puro.

export interface ContaSalva {
  email: string;
  name: string;
  roleLabel: string;
  photoUrl?: string | null;
  senhaCifrada?: string | null;
  ultimoUso: number;
}

const CHAVE = 'ntb-contas-salvas';

export const lerContasSalvas = (): ContaSalva[] => {
  try {
    const lista: ContaSalva[] = JSON.parse(localStorage.getItem(CHAVE) || '[]');
    return Array.isArray(lista) ? lista.sort((a, b) => b.ultimoUso - a.ultimoUso) : [];
  } catch {
    return [];
  }
};

const gravar = (lista: ContaSalva[]) => {
  try { localStorage.setItem(CHAVE, JSON.stringify(lista)); } catch { /* sem armazenamento */ }
};

export const salvarConta = (conta: ContaSalva) => {
  const lista = lerContasSalvas().filter((c) => c.email.toLowerCase() !== conta.email.toLowerCase());
  gravar([conta, ...lista]);
};

export const removerContaSalva = (email: string) => {
  gravar(lerContasSalvas().filter((c) => c.email.toLowerCase() !== email.toLowerCase()));
};

export const rotuloDoPapel = (role: string, permissions?: { caixa?: boolean; admin?: boolean } | null): string => {
  if (role === 'universal') return 'Suporte Norte';
  if (role === 'owner') return 'Lojista';
  if (role === 'manager') return 'Gerente';
  if (permissions?.caixa) return 'Caixa';
  if (role === 'waiter' || role === 'garcom') return 'Garçom';
  if (permissions?.admin) return 'Administração';
  return 'Equipe';
};
