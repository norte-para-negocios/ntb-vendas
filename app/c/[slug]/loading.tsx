import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3 text-primary">
        <Loader2 className="animate-spin w-10 h-10" />
        <span className="font-medium text-gray-500 animate-pulse">Carregando cardápio...</span>
      </div>
    </div>
  );
}
