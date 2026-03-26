import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useHostStore } from '../store/useHostStore';
import { useUiSettingsStore } from '../store/useUiSettingsStore';

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
    toast.success('恢复密钥已生成', {
      description: '请离线保存，避免与主密码保存在同一位置。'
    });
  };

  const copyRecoveryKey = async (): Promise<void> => {
    if (!recoveryKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(recoveryKey);
      toast.success('恢复密钥已复制到剪贴板');
    } catch (_error) {
      toast.error('复制失败，请手动记录恢复密钥');
    }
  };

  const initializeVault = async (): Promise<void> => {
    setLocalError(null);

    const parsed = setupPasswordSchema.safeParse({
      masterPassword,
      confirmPassword
    });

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? '请输入合法的主密码。';
      setLocalError(firstError);
      return;
    }

    await unlockVault(masterPassword);
    const appView = useHostStore.getState().appView;
    if (appView !== 'dashboard') {
      setLocalError('主密码设置失败，请检查后重试。');
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
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8fb0de]">Loyu Terminal</p>
            <h1 className="mt-2 text-2xl font-semibold text-white">首次启动引导</h1>
          </div>
          <p className="text-xs text-[#9cb7db]">步骤 {step}/4</p>
        </div>

        <div className="mt-4 h-1.5 rounded-full bg-[#163050]">
          <div
            className="h-1.5 rounded-full bg-[#64a0ff] transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {step === 1 && (
          <div className="mt-8 space-y-5">
            <h2 className="text-3xl font-semibold leading-tight text-white">欢迎来到罗屿</h2>
            <p className="max-w-2xl text-sm leading-7 text-[#b8cae7]">
              罗屿强调三件事：安全、直观、智能。你将在几分钟内完成金库初始化，并准备好第一台服务器连接。
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <article className="rounded-2xl border border-[#2a466d] bg-[#0a1a2d]/70 p-4">
                <p className="text-sm font-semibold text-white">安全</p>
                <p className="mt-2 text-xs leading-6 text-[#a6bfdc]">本地金库采用端到端加密，主密码仅在你设备侧参与解密。</p>
              </article>
              <article className="rounded-2xl border border-[#2a466d] bg-[#0a1a2d]/70 p-4">
                <p className="text-sm font-semibold text-white">直观</p>
                <p className="mt-2 text-xs leading-6 text-[#a6bfdc]">主机、身份、终端与 SFTP 一体化管理，减少心智切换。</p>
              </article>
              <article className="rounded-2xl border border-[#2a466d] bg-[#0a1a2d]/70 p-4">
                <p className="text-sm font-semibold text-white">智能</p>
                <p className="mt-2 text-xs leading-6 text-[#a6bfdc]">内置 AI 指令助手与会话能力，帮助你更快完成运维动作。</p>
              </article>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-8 space-y-5">
            <h2 className="text-3xl font-semibold leading-tight text-white">E2EE 端到端加密说明</h2>
            <p className="max-w-2xl text-sm leading-7 text-[#b8cae7]">
              你的主机数据会先在本地加密，再写入金库文件。解密密钥从主密码派生，我们不会上传或托管你的主密码。
            </p>
            <div className="rounded-2xl border border-rose-300/40 bg-rose-500/10 p-4">
              <p className="text-sm font-semibold text-rose-100">重要提示</p>
              <p className="mt-2 text-xs leading-6 text-rose-100/90">
                我们不存储您的主密码，一旦丢失将无法找回您的数据。请务必妥善保管。
              </p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-8 space-y-5">
            <h2 className="text-3xl font-semibold leading-tight text-white">设置主密码</h2>
            <p className="max-w-2xl text-sm leading-7 text-[#b8cae7]">
              建议使用 12 位以上高强度密码，并避免与其他网站密码复用。
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#95b0d8]">主密码</label>
                <input
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-[#35547f] bg-[#0c1d33] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#63a2ff] focus:ring-2 focus:ring-[#63a2ff]/25"
                  disabled={isUnlocking}
                  onChange={(event) => setMasterPassword(event.target.value)}
                  placeholder="至少 12 位，含大小写/数字/符号"
                  type="password"
                  value={masterPassword}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#95b0d8]">确认主密码</label>
                <input
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-[#35547f] bg-[#0c1d33] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#63a2ff] focus:ring-2 focus:ring-[#63a2ff]/25"
                  disabled={isUnlocking}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="再次输入主密码"
                  type="password"
                  value={confirmPassword}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-[#2a466d] bg-[#0a1a2d]/70 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-white">恢复密钥（可选）</p>
                <button
                  className="rounded-lg border border-[#3f679b] bg-[#112844] px-2.5 py-1 text-xs text-[#d8e8ff] hover:bg-[#16345a]"
                  onClick={generateRecoveryKey}
                  type="button"
                >
                  生成恢复密钥
                </button>
                <button
                  className="rounded-lg border border-[#3f679b] bg-[#112844] px-2.5 py-1 text-xs text-[#d8e8ff] hover:bg-[#16345a] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!recoveryKey}
                  onClick={() => {
                    void copyRecoveryKey();
                  }}
                  type="button"
                >
                  复制
                </button>
              </div>
              <p className="mt-2 text-xs leading-6 text-[#a9c2df]">用于极端情况下的本地解密辅助，请离线保存，切勿公开。</p>
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
            <h2 className="text-3xl font-semibold leading-tight text-white">准备连接第一台服务器</h2>
            <p className="max-w-2xl text-sm leading-7 text-[#b8cae7]">
              你可以直接进入仪表盘，或者使用“添加我的第一台服务器”快速填充一份示例连接模板。
            </p>

            <div className="rounded-2xl border border-[#2a466d] bg-[#0a1a2d]/70 p-4 text-xs leading-6 text-[#a6bfdc]">
              快速模板将预填：`127.0.0.1:22`、身份名“默认身份”、用户名 `root`，你可在向导中自行修改。
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
            上一步
          </button>

          {step < 3 && (
            <button
              className="rounded-xl bg-[#2d78e6] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3a84ef]"
              onClick={goNext}
              type="button"
            >
              下一步
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
              {isUnlocking ? '初始化中...' : '完成初始化'}
            </button>
          )}

          {step === 4 && (
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-xl border border-[#3a5d8b] bg-[#10233d] px-4 py-2.5 text-sm text-[#d7e7ff] transition hover:bg-[#163157]"
                onClick={() => finishOnboarding(false)}
                type="button"
              >
                进入仪表盘
              </button>
              <button
                className="rounded-xl bg-[#2d78e6] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3a84ef]"
                onClick={() => finishOnboarding(true)}
                type="button"
              >
                添加我的第一台服务器
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
