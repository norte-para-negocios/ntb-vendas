import React, { Suspense, lazy } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { Loader2 } from 'lucide-react';

const { HashRouter, Routes, Route, Navigate, Link } = ReactRouterDOM as any;

// Lazy load modules to optimize bundle size and avoid "Large Chunk" warnings
const AdminModule = lazy(() => import('./modules/AdminModule').then(module => ({ default: module.AdminModule })));
const StoreModule = lazy(() => import('./modules/StoreModule').then(module => ({ default: module.StoreModule })));
const ClientModule = lazy(() => import('./modules/ClientModule').then(module => ({ default: module.ClientModule })));

// Simple Landing/Home
const Home = () => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-primary-dark to-primary p-6 text-white text-center">
    <div className="animate-fade-in flex flex-col items-center">
        <h1 className="text-4xl md:text-6xl font-bold mb-4 tracking-tight">Cardápio Digital</h1>
        <p className="text-lg md:text-xl opacity-90 mb-10 max-w-lg leading-relaxed">
        A solução completa para seu restaurante. Pedidos, cozinha e pagamentos em um só lugar.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
            <Link to="/painel" className="bg-white text-primary px-6 py-4 rounded-xl font-bold hover:bg-gray-100 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 flex-1 flex items-center justify-center">
                Painel Master (Admin)
            </Link>
            <Link to="/loja" className="bg-primary-light/20 border-2 border-white/30 backdrop-blur-sm px-6 py-4 rounded-xl font-bold hover:bg-white/20 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 flex-1 flex items-center justify-center">
                Área do Lojista
            </Link>
        </div>

        <div className="mt-16 pt-8 border-t border-white/10 w-full max-w-sm">
            <p className="text-xs font-mono text-white/60 uppercase tracking-widest mb-3">Acesso Rápido (Exemplo Cliente)</p>
            <Link to="/c/bistro" className="text-lg font-medium hover:text-yellow-300 transition-colors border-b border-white/30 hover:border-yellow-300 pb-0.5">
                Acessar Cardápio Demo
            </Link>
        </div>
    </div>
  </div>
);

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50 text-primary">
    <div className="flex flex-col items-center gap-3">
        <Loader2 className="animate-spin w-10 h-10" />
        <span className="font-medium animate-pulse">Carregando módulo...</span>
    </div>
  </div>
);

const App: React.FC = () => {
  return (
    <AppProvider>
      <HashRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/painel/*" element={<AdminModule />} />
            <Route path="/loja/*" element={<StoreModule />} />
            <Route path="/c/:slug" element={<ClientModule />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </AppProvider>
  );
};

export default App;