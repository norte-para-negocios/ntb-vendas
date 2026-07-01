import Link from 'next/link';
import { LayoutDashboard, Store, UtensilsCrossed } from 'lucide-react';
import { stagger } from '@/components/Skeleton';

export default function HomePage() {
  return (
    <div className="auth-shell min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-primary-dark to-primary p-6 text-white text-center">
      <div className="auth-mesh" />
      <div className="auth-orb" style={{ width: 340, height: 340, top: '-8%', left: '-6%', background: 'var(--brand)' }} />
      <div className="auth-orb" style={{ width: 300, height: 300, bottom: '-10%', right: '-8%', background: 'var(--err)', animationDelay: '-6s' }} />
      <div className="auth-grain" />

      <div className="relative z-[1] flex flex-col items-center w-full max-w-2xl">

        <div className="mb-8">
          <div className="u-stagger bg-white/10 backdrop-blur-sm border border-white/20 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl" style={stagger(0)}>
            <UtensilsCrossed className="w-10 h-10 text-white" />
          </div>
          <h1 className="u-stagger text-5xl md:text-6xl font-bold mb-4 tracking-tight" style={stagger(60)}>
            Cardápio Digital
          </h1>
          <p className="u-stagger text-lg md:text-xl opacity-90 max-w-lg leading-relaxed" style={stagger(120)}>
            A solução completa para seu restaurante. Pedidos, cozinha e pagamentos em um só lugar.
          </p>
        </div>

        <div className="u-stagger flex flex-col sm:flex-row gap-4 w-full max-w-md mb-16" style={stagger(180)}>
          <Link
            href="/painel"
            className="u-motion bg-white text-[var(--brand)] px-6 py-4 rounded-xl font-bold hover:bg-[var(--surface-2)] shadow-lg hover:shadow-xl hover:-translate-y-1 flex-1 flex items-center justify-center gap-2"
          >
            <LayoutDashboard className="w-5 h-5" />
            Painel Master
          </Link>
          <Link
            href="/loja"
            className="u-motion bg-white/10 border-2 border-white/30 backdrop-blur-sm px-6 py-4 rounded-xl font-bold hover:bg-white/20 shadow-lg hover:shadow-xl hover:-translate-y-1 flex-1 flex items-center justify-center gap-2"
          >
            <Store className="w-5 h-5" />
            Área do Lojista
          </Link>
        </div>

        <div className="u-stagger pt-8 border-t border-white/10 w-full max-w-sm" style={stagger(230)}>
          <p className="text-xs font-mono text-white/60 uppercase tracking-widest mb-3">
            Acesso Rápido (Exemplo Cliente)
          </p>
          <Link
            href="/c/bistro"
            className="u-motion text-lg font-medium hover:text-[var(--warn)] border-b border-white/30 hover:border-[var(--warn)] pb-0.5"
          >
            Acessar Cardápio Demo
          </Link>
        </div>
      </div>
    </div>
  );
}
