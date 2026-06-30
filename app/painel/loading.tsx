import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <div className="flex flex-col items-center gap-3 text-[var(--brand)]">
        <Loader2 className="animate-spin w-10 h-10" />
        <span className="font-medium text-[var(--text-muted)] animate-pulse">Carregando...</span>
      </div>
    </div>
  );
}
