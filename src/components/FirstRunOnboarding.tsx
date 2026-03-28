import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useHostStore } from '../store/useHostStore';
import { useUiSettingsStore } from '../store/useUiSettingsStore';
import { useI18n } from '../i18n/useI18n';

type OnboardingStep = 1 | 2 | 3 | 4;

const setupPasswordSchema = z
  .object({
    masterPassword: z
      .string()
      .min(12, '主密码至少 12 位')
      .regex(/[a-z]/, '需包含小写字母')
      .regex(/[A-Z]/, '需包含大写字母')
      .regex(/[0-9]/, '需包含数字')
      .regex(/[^A-Za-z0-9]/, '需包含特殊符号'),
    confirmPassword: z.string().min(1, '请再次输入主密码')
  })
  .refine((payload) => payload.masterPassword === payload.confirmPassword, {
    message: '两次输入的主密码不一致',
    path: ['confirmPassword']
  });

const createRecoveryKey = (): string => {
  const seed = new Uint8Array(24);
  crypto.getRandomValues(seed);
  const hex = Array.from(seed)
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  const blocks = hex.match(/.{1,6}/g) ?? [hex];
  return blocks.join('-');
};

export function FirstRunOnboarding(): JSX.Element {
  const { t } = useI18n();
  const unlockVault = useHostStore((state) => state.unlockVault);
  const isUnlocking = useHostStore((state) => state.isUnlocking);
  const unlockError = useHostStore((state) => state.unlockError);
  const applyDemoHostTemplate = useHostStore((state) => state.applyDemoHostTemplate);
  const setHasCompletedOnboarding = useUiSettingsStore((state) => state.setHasCompletedOnboarding);

  const [step, setStep] = useState<OnboardingStep>(1);
  const [masterPassword, setMasterPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string>('');

  const canGoBack = step > 1 && step < 4;
  const progress = useMemo(() => {
    return (step / 4) * 100;
  }, [step]);

  const goNext = (): void => {
    setLocalError(null);
    setStep((prev) => (prev < 4 ? ((prev + 1) as OnboardingStep) : prev));
  };

  const goBack = (): void => {
    setLocalError(null);
    setStep((prev) => (prev > 1 ? ((prev - 1) as OnboardingStep) : prev));
  };

  const generateRecoveryKey = (): void => {
    const key = createRecoveryKey();
    setRecoveryKey(key);
    toast.success(t('onboarding.toastRecoveryGenerated'), {
      description: t('onboarding.toastRecoveryGeneratedDesc')
    });
  };

  const copyRecoveryKey = async (): Promise<void> => {
    if (!recoveryKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(recoveryKey);
      toast.success(t('onboarding.toastRecoveryCopied'));
    } catch (_error) {
      toast.error(t('onboarding.toastRecoveryCopyFailed'));
    }
  };

  const initializeVault = async (): Promise<void> => {
    setLocalError(null);

    const parsed = setupPasswordSchema.safeParse({
      masterPassword,
      confirmPassword
    });

    if (!parsed.success) {
      setLocalError(t('onboarding.errorInvalidPassword'));
      return;
    }

    await unlockVault(masterPassword);
    const state = useHostStore.getState();
    const appView = state.appView;
    if (appView !== 'dashboard') {
      setLocalError(state.unlockError ?? t('onboarding.errorInitFailed'));
      return;
    }

    setMasterPassword('');
    setConfirmPassword('');
    setStep(4);
  };

  const finishOnboarding = (withDemo: boolean): void => {
    if (withDemo) {
      applyDemoHostTemplate();
    }
    setHasCompletedOnboarding(true);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#04070e] px-6 py-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_16%,rgba(90,138,201,0.35),transparent_35%),radial-gradient(circle_at_86%_12%,rgba(92,159,246,0.22),transparent_34%),radial-gradient(circle_at_50%_88%,rgba(25,47,84,0.62),transparent_44%)]" />

      <section className="relative w-full max-w-3xl rounded-3xl border border-[#29456d] bg-[#071322]/80 p-7 text-[#e4eeff] shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-9">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8fb0de]">OrbitTerm</p>
            <h1 className="mt-2 text-2xl font-semibold text-white">{t('onboarding.title')}</h1>
          </div>
          <p className="text-xs text-[#9cb7db]">{t('onboarding.step', { step })}</p>
        </div>

        <div className="mt-4 h-1.5 rounded-full bg-[#163050]">
          <div
            className="h-1.5 rounded-full bg-[#64a0ff] transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {step === 1 && (
          <div className="mt-8 space-y-5">
            <h2 className="text-3xl font-semibold leading-tight text-white">{t('onboarding.welcomeTitle')}</h2>
            <p className="max-w-2xl text-sm leading-7 text-[#b8cae7]">
              {t('onboarding.welcomeDesc')}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <article className="overflow-hidden rounded-2xl border border-[#31547f] bg-[linear-gradient(140deg,#0e253f,#11375f)] p-4">
                <div className="mb-3 h-16 rounded-xl bg-[radial-gradient(circle_at_20%_40%,rgba(132,189,255,0.42),transparent_46%),radial-gradient(circle_at_85%_20%,rgba(93,225,181,0.3),transparent_44%)]" />
                <p className="text-sm font-semibold text-white">{t('persona.ops.title')}</p>
                <p className="mt-2 text-xs leading-6 text-[#b5ceed]">{t('persona.ops.desc')}</p>
              </article>
              <article className="overflow-hidden rounded-2xl border border-[#4a4f8a] bg-[linear-gradient(140deg,#1f224d,#283a7a)] p-4">
                <div className="mb-3 h-16 rounded-xl bg-[radial-gradient(circle_at_15%_35%,rgba(199,156,255,0.4),transparent_46%),radial-gradient(circle_at_82%_20%,rgba(101,175,255,0.32),transparent_44%)]" />
                <p className="text-sm font-semibold text-white">{t('persona.dev.title')}</p>
                <p className="mt-2 text-xs leading-6 text-[#c3cdf6]">{t('persona.dev.desc')}</p>
              </article>
              <article className="overflow-hidden rounded-2xl border border-[#6a5a37] bg-[linear-gradient(140deg,#3f3323,#594524)] p-4">
                <div className="mb-3 h-16 rounded-xl bg-[radial-gradient(circle_at_20%_40%,rgba(255,220,136,0.4),transparent_46%),radial-gradient(circle_at_84%_24%,rgba(255,169,109,0.32),transparent_44%)]" />
                <p className="text-sm font-semibold text-white">{t('persona.newbie.title')}</p>
                <p className="mt-2 text-xs leading-6 text-[#f0ddbe]">{t('persona.newbie.desc')}</p>
              </article>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-8 space-y-5">
            <h2 className="text-3xl font-semibold leading-tight text-white">{t('onboarding.e2eeTitle')}</h2>
            <p className="max-w-2xl text-sm leading-7 text-[#b8cae7]">
              {t('onboarding.e2eeDesc')}
            </p>
            <div className="rounded-2xl border border-rose-300/40 bg-rose-500/10 p-4">
              <p className="text-sm font-semibold text-rose-100">{t('onboarding.important')}</p>
              <p className="mt-2 text-xs leading-6 text-rose-100/90">
                {t('onboarding.importantDesc')}
              </p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-8 space-y-5">
            <h2 className="text-3xl font-semibold leading-tight text-white">{t('onboarding.passwordTitle')}</h2>
            <p className="max-w-2xl text-sm leading-7 text-[#b8cae7]">
              {t('onboarding.passwordDesc')}
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#95b0d8]">
                  {t('onboarding.passwordLabel')}
                </label>
                <input
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-[#35547f] bg-[#0c1d33] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#63a2ff] focus:ring-2 focus:ring-[#63a2ff]/25"
                  disabled={isUnlocking}
                  onChange={(event) => setMasterPassword(event.target.value)}
                  placeholder={t('onboarding.passwordPlaceholder')}
                  type="password"
                  value={masterPassword}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#95b0d8]">
                  {t('onboarding.passwordConfirmLabel')}
                </label>
                <input
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-[#35547f] bg-[#0c1d33] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#63a2ff] focus:ring-2 focus:ring-[#63a2ff]/25"
                  disabled={isUnlocking}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder={t('onboarding.passwordConfirmPlaceholder')}
                  type="password"
                  value={confirmPassword}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-[#2a466d] bg-[#0a1a2d]/70 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-white">{t('onboarding.recoveryTitle')}</p>
                <button
                  className="rounded-lg border border-[#3f679b] bg-[#112844] px-2.5 py-1 text-xs text-[#d8e8ff] hover:bg-[#16345a]"
                  onClick={generateRecoveryKey}
                  type="button"
                >
                  {t('onboarding.generateRecovery')}
                </button>
                <button
                  className="rounded-lg border border-[#3f679b] bg-[#112844] px-2.5 py-1 text-xs text-[#d8e8ff] hover:bg-[#16345a] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!recoveryKey}
                  onClick={() => {
                    void copyRecoveryKey();
                  }}
                  type="button"
                >
                  {t('common.copy')}
                </button>
              </div>
              <p className="mt-2 text-xs leading-6 text-[#a9c2df]">{t('onboarding.recoveryHint')}</p>
              {recoveryKey && (
                <code className="mt-3 block overflow-x-auto rounded-lg border border-[#2f4f7a] bg-[#091729] px-3 py-2 text-xs text-[#d7e7ff]">
                  {recoveryKey}
                </code>
              )}
            </div>

            {(localError || unlockError) && (
              <p className="text-sm text-rose-300">{localError ?? unlockError}</p>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="mt-8 space-y-5">
            <h2 className="text-3xl font-semibold leading-tight text-white">{t('onboarding.finishTitle')}</h2>
            <p className="max-w-2xl text-sm leading-7 text-[#b8cae7]">
              {t('onboarding.finishDesc')}
            </p>

            <div className="rounded-2xl border border-[#2a466d] bg-[#0a1a2d]/70 p-4 text-xs leading-6 text-[#a6bfdc]">
              {t('onboarding.quickTemplate')}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <button
            className="rounded-xl border border-[#3a5d8b] bg-[#10233d] px-4 py-2.5 text-sm text-[#d7e7ff] transition hover:bg-[#163157] disabled:opacity-50"
            disabled={!canGoBack}
            onClick={goBack}
            type="button"
          >
            {t('common.back')}
          </button>

          {step < 3 && (
            <button
              className="rounded-xl bg-[#2d78e6] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3a84ef]"
              onClick={goNext}
              type="button"
            >
              {t('common.next')}
            </button>
          )}

          {step === 3 && (
            <button
              className="rounded-xl bg-[#2d78e6] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3a84ef] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isUnlocking}
              onClick={() => {
                void initializeVault();
              }}
              type="button"
            >
              {isUnlocking ? t('onboarding.initLoading') : t('onboarding.initAction')}
            </button>
          )}

          {step === 4 && (
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-xl border border-[#3a5d8b] bg-[#10233d] px-4 py-2.5 text-sm text-[#d7e7ff] transition hover:bg-[#163157]"
                onClick={() => finishOnboarding(false)}
                type="button"
              >
                {t('onboarding.enterDashboard')}
              </button>
              <button
                className="rounded-xl bg-[#2d78e6] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3a84ef]"
                onClick={() => finishOnboarding(true)}
                type="button"
              >
                {t('onboarding.addFirstServer')}
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
