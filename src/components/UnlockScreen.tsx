import { useState } from 'react';
import { useHostStore } from '../store/useHostStore';

export function UnlockScreen(): JSX.Element {
  const unlockVault = useHostStore((state) => state.unlockVault);
  const isUnlocking = useHostStore((state) => state.isUnlocking);
  const unlockError = useHostStore((state) => state.unlockError);

  const [masterPassword, setMasterPassword] = useState<string>('');

  const runUnlock = async (): Promise<void> => {
    if (!masterPassword.trim() || isUnlocking) {
      return;
    }

    await unlockVault(masterPassword);
    setMasterPassword('');
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.42),transparent_35%),radial-gradient(circle_at_78%_16%,rgba(190,220,255,0.5),transparent_32%),radial-gradient(circle_at_50%_82%,rgba(225,238,255,0.75),transparent_45%)]" />
      <section className="glass-card relative w-full max-w-xl rounded-3xl border border-white/60 bg-white/45 p-10 shadow-glass">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
          Loyu Terminal · Vault
        </p>
        <h1 className="mt-4 text-center text-2xl font-semibold text-slate-900">金库解锁</h1>
        <p className="mt-2 text-center text-sm text-slate-600">输入主密码后按 Enter 解锁。</p>

        <div className="mt-8">
          <input
            autoComplete="current-password"
            className="w-full rounded-2xl border border-white/65 bg-white/75 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-frost-accent/70 focus:ring-2 focus:ring-frost-accent/20"
            disabled={isUnlocking}
            onChange={(event) => setMasterPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void runUnlock();
              }
            }}
            placeholder={isUnlocking ? '正在解锁...' : '请输入主密码'}
            type="password"
            value={masterPassword}
          />
        </div>

        {unlockError && <p className="mt-3 text-center text-sm text-rose-500">{unlockError}</p>}
      </section>
    </main>
  );
}
