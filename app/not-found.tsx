import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-primary-dark to-primary p-6 text-white text-center">
      <div className="animate-fade-in flex flex-col items-center">
        <div className="bg-white/10 backdrop-blur-sm border border-white/20 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6">
          <UtensilsCrossed className="w-10 h-10 text-white opacity-60" />
        </div>
        <h1 className="text-6xl font-bold mb-4 opacity-60">404</h1>
        <h2 className="text-2xl font-bold mb-2">Página não encontrada</h2>
        <p className="text-white/70 mb-8">O cardápio ou recurso que você procura não existe.</p>
        <Link
          href="/"
          className="bg-white text-primary px-6 py-3 rounded-xl font-bold hover:bg-gray-100 transition-all shadow-lg"
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
