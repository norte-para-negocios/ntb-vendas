import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';
import { stagger } from '@/components/Skeleton';

export default function NotFound() {
  return (
    <div className="auth-shell min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-primary-dark to-primary p-6 text-white text-center">
      <div className="auth-mesh" />
      <div className="auth-orb" style={{ width: 280, height: 280, top: '-10%', right: '-6%', background: 'var(--err)' }} />
      <div className="auth-orb" style={{ width: 260, height: 260, bottom: '-12%', left: '-8%', background: 'var(--brand)', animationDelay: '-4s' }} />
      <div className="auth-grain" />

      <div className="relative z-[1] flex flex-col items-center">
        <div className="u-stagger bg-white/10 backdrop-blur-sm border border-white/20 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6" style={stagger(0)}>
          <UtensilsCrossed className="w-10 h-10 text-white opacity-60" />
        </div>
        <h1 className="u-stagger text-6xl font-bold mb-4 opacity-60" style={stagger(60)}>404</h1>
        <h2 className="u-stagger text-2xl font-bold mb-2" style={stagger(110)}>Página não encontrada</h2>
        <p className="u-stagger text-white/70 mb-8" style={stagger(150)}>O cardápio ou recurso que você procura não existe.</p>
        <Link
          href="/"
          className="u-stagger u-motion bg-white text-[var(--brand)] px-6 py-3 rounded-xl font-bold hover:bg-[var(--surface-2)] shadow-lg"
          style={stagger(190)}
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
