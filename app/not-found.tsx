import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';
import { AuthBackdrop } from '@/components/AuthBackdrop';

export default function NotFound() {
  return (
    <AuthBackdrop>
      <div className="flex flex-col items-center text-center text-white u-grow-in">
        <div className="bg-white/12 backdrop-blur-sm border border-white/25 w-20 h-20 rounded-[1.6rem] flex items-center justify-center mx-auto mb-6" style={{ animation: '3s ease-in-out infinite icon-float' }}>
          <UtensilsCrossed className="w-10 h-10 text-white opacity-70" />
        </div>
        <h1 className="text-7xl font-bold mb-3 tracking-tight text-white/85">404</h1>
        <h2 className="text-2xl font-bold mb-2">Página não encontrada</h2>
        <p className="text-white/70 mb-8 max-w-xs">O cardápio ou recurso que você procura não existe.</p>
        <Link
          href="/"
          className="u-motion u-press bg-white text-[var(--brand)] px-6 py-3 rounded-2xl font-bold hover:bg-white/90 shadow-lg"
        >
          Voltar ao início
        </Link>
      </div>
    </AuthBackdrop>
  );
}
