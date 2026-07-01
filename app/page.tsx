import Link from 'next/link';
import { LayoutDashboard, Store, UtensilsCrossed, ArrowRight } from 'lucide-react';
import { stagger } from '@/components/Skeleton';

export default function HomePage() {
  return (
    <div className="auth-shell min-h-screen flex flex-col items-center justify-center bg-[var(--ink)] p-6 text-white text-center">
      <div className="auth-mesh" />
      <div className="auth-orb" style={{ width: 380, height: 380, top: '-10%', left: '-8%', background: 'var(--brand)' }} />
      <div className="auth-orb" style={{ width: 320, height: 320, bottom: '-12%', right: '-10%', background: 'var(--err)', animationDelay: '-6s' }} />
      <div className="auth-grain" />

      <div className="relative z-[1] flex flex-col items-center w-full max-w-md">
        <span
          className="u-stagger inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider bg-white/10 border border-white/15 rounded-full px-3 py-1 mb-6"
          style={stagger(0)}
        >
          Norte Para Negócios
        </span>

        <div className="u-stagger bg-white/10 backdrop-blur-sm border border-white/20 w-20 h-20 rounded-3xl flex items-center justify-center mb-6" style={stagger(50)}>
          <UtensilsCrossed className="w-10 h-10 text-white" />
        </div>

        <h1 className="u-stagger text-4xl md:text-5xl font-bold tracking-tight mb-4" style={stagger(100)}>
          Cardápio Digital
        </h1>
        <p className="u-stagger text-white/70 leading-relaxed mb-10 max-w-sm" style={stagger(150)}>
          Pedidos, cozinha, mesas e pagamento em um só sistema.
        </p>

        <div className="u-stagger flex flex-col sm:flex-row gap-3 w-full mb-10" style={stagger(200)}>
          <Link
            href="/painel"
            className="u-motion u-press bg-white text-[var(--brand)] px-6 py-3.5 rounded-full font-bold shadow-lg hover:shadow-xl flex-1 flex items-center justify-center gap-2"
          >
            <LayoutDashboard size={18} />
            Painel Master
          </Link>
          <Link
            href="/loja"
            className="u-motion u-press bg-white/10 border border-white/20 hover:bg-white/15 px-6 py-3.5 rounded-full font-bold flex-1 flex items-center justify-center gap-2"
          >
            <Store size={18} />
            Área do Lojista
          </Link>
        </div>

        <Link
          href="/c/bistro"
          className="u-stagger u-motion group inline-flex items-center gap-1.5 text-sm font-medium text-white/60 hover:text-white border-b border-white/20 hover:border-white/60 pb-0.5"
          style={stagger(240)}
        >
          Ver cardápio de demonstração
          <ArrowRight size={14} className="u-motion group-hover:translate-x-1" />
        </Link>
      </div>
    </div>
  );
}
