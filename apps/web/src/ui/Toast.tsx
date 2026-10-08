import clsx from 'clsx';
import { CheckCircle2, X, XCircle, Info } from 'lucide-react';
import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

interface T { id: number; tone: 'success' | 'error' | 'info'; text: string }
const Ctx = createContext<{ toast: (tone: T['tone'], text: string) => void }>({ toast: () => {} });
export const useToast = () => useContext(Ctx);
let n = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const toast = useCallback((tone: T['tone'], text: string) => {
    const id = ++n; setItems((s) => [...s, { id, tone, text }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={clsx('pointer-events-auto flex items-start gap-3 rounded-lg border bg-white px-4 py-3 text-sm shadow-pop', t.tone === 'error' ? 'border-red-200' : t.tone === 'success' ? 'border-green-200' : 'border-blue-200')}>
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" /> : t.tone === 'error' ? <XCircle className="mt-0.5 h-4 w-4 text-red-600" /> : <Info className="mt-0.5 h-4 w-4 text-blue-600" />}
            <p className="flex-1 text-ink">{t.text}</p>
            <button aria-label="Dismiss" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
