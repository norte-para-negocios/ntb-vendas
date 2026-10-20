'use client';

// Convite por link (20/10/2026, migration 181): o gerente manda o link, a pessoa cria o próprio login e a própria senha.
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Button, Input } from '@/components/ui';

type Convite = { name: string; role: string; store_name: string };
const FUNCAO: Record<string, string> = { waiter: 'Garçom', cashier: 'Caixa', cook: 'Cozinha', attendant: 'Atendente', manager: 'Gerente' };
const ERRO_CONVITE: Record<string, string> = {
  invalido: 'Este convite não existe. Peça um novo ao gerente.',
  usado: 'Este convite já foi usado. Se foi você, é só entrar no app com o seu e-mail ou nome e a sua senha.',
  expirado: 'Este convite venceu. Peça um novo ao gerente.',
};

export default function ConvitePage() {
  const { token } = useParams<{ token: string }>();
  const [convite, setConvite] = useState<Convite | null>(null);
  const [erroConvite, setErroConvite] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [pronto, setPronto] = useState<{ email: string | null; name: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await supabase.rpc('get_store_user_invite_secure', { p_token: token });
      if (!vivo) return;
      if (error || !data) setErroConvite('Sem conexão. Confira a internet e abra o link de novo.');
      else if (!data.success) setErroConvite(ERRO_CONVITE[data.error] ?? 'Convite inválido.');
      else { setConvite(data as Convite); setNome((data as Convite).name); }
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [token]);

  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    const { data, error } = await supabase.rpc('accept_store_user_invite_secure', { p_token: token, p_email: email, p_password: senha, p_name: nome });
    setEnviando(false);
    if (error || !data) { setErro('Sem conexão. Tente de novo.'); return; }
    if (!data.success) { setErro(data.message || 'Não foi possível criar o login.'); return; }
    setPronto({ email: data.email ?? null, name: data.name });
  };

  const garcom = convite?.role === 'waiter';
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-10" style={{ background: '#484DB5' }}>
      <div className="w-full max-w-sm bg-[var(--surface)] text-[var(--text)] rounded-[22px] p-6 shadow-xl">
        {carregando ? (
          <p className="text-center text-sm text-[var(--text-muted)]">Abrindo o convite…</p>
        ) : pronto ? (
          <div className="space-y-4 text-center">
            <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Pronto, {pronto.name.split(' ')[0]}!</h1>
            <p className="text-[15px] text-[var(--text-muted)]">
              Seu login foi criado. Para entrar no app, use {pronto.email ? <b>{pronto.email}</b> : <b>o seu nome ({pronto.name})</b>} e a senha que você acabou de escolher.
            </p>
            <a href="/loja" className="inline-flex h-11 w-full items-center justify-center rounded-[var(--r-md)] bg-[var(--brand-fill)] text-white font-semibold">Entrar agora</a>
          </div>
        ) : erroConvite || !convite ? (
          <div className="space-y-3 text-center">
            <h1 className="text-[20px] font-semibold">Convite</h1>
            <p className="text-[15px] text-[var(--text-muted)]">{erroConvite}</p>
          </div>
        ) : (
          <form onSubmit={criar} className="space-y-4">
            <div>
              <p className="text-[13px] text-[var(--text-muted)]">{convite.store_name}</p>
              <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Crie o seu login</h1>
              <p className="text-[14px] text-[var(--text-muted)] mt-1">Você foi convidado como <b>{FUNCAO[convite.role] ?? convite.role}</b>. Escolha o seu e-mail e a sua senha: só você vai saber.</p>
            </div>
            <Input label="Seu nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
            <Input label={garcom ? 'E-mail (opcional)' : 'E-mail'} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder={garcom ? 'Sem e-mail, você entra pelo nome' : 'seu@email.com'} />
            <Input label="Crie uma senha (mínimo 6)" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
            {erro && <p className="text-sm text-[var(--err)]" role="alert">{erro}</p>}
            <Button type="submit" size="lg" className="w-full" isLoading={enviando} disabled={senha.length < 6 || nome.trim().length < 2}>Criar meu login</Button>
          </form>
        )}
      </div>
    </main>
  );
}
