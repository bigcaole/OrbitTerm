import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useHostStore } from '../../store/useHostStore';

interface CloudAuthModalProps {
  open: boolean;
  onSkip: () => void;
  onSuccess: () => void;
}

interface CloudAuthHints {
  apiBaseUrl: string;
  email: string;
}

const CLOUD_AUTH_HINT_KEY = 'orbitterm:cloud-auth-hints:v1';

const readAuthHints = (): CloudAuthHints => {
  const fallback: CloudAuthHints = {
    apiBaseUrl: '',
    email: ''
  };
  const raw = window.localStorage.getItem(CLOUD_AUTH_HINT_KEY);
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CloudAuthHints>;
    return {
      apiBaseUrl: typeof parsed.apiBaseUrl === 'string' ? parsed.apiBaseUrl : '',
      email: typeof parsed.email === 'string' ? parsed.email : ''
    };
  } catch (_error) {
    return fallback;
  }
};

const writeAuthHints = (hints: CloudAuthHints): void => {
  window.localStorage.setItem(CLOUD_AUTH_HINT_KEY, JSON.stringify(hints));
};

export function CloudAuthModal({ open, onSkip, onSuccess }: CloudAuthModalProps): JSX.Element | null {
  const isSyncingCloud = useHostStore((state) => state.isSyncingCloud);
  const cloudSyncError = useHostStore((state) => state.cloudSyncError);
  const registerCloudAccount = useHostStore((state) => state.registerCloudAccount);
  const loginCloudAccount = useHostStore((state) => state.loginCloudAccount);

  const [apiBaseUrl, setApiBaseUrl] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');

  useEffect(() => {
    if (!open) {
      return;
    }
    const hints = readAuthHints();
    setApiBaseUrl(hints.apiBaseUrl);
    setEmail(hints.email);
    setPassword('');
  }, [open]);

  const normalizedHints = useMemo<CloudAuthHints>(() => {
    return {
      apiBaseUrl: apiBaseUrl.trim(),
      email: email.trim()
    };
  }, [apiBaseUrl, email]);

  const handleRegister = async (): Promise<void> => {
    if (!normalizedHints.apiBaseUrl || !normalizedHints.email || !password.trim()) {
      toast.error('请完整填写同步地址、邮箱与密码。');
      return;
    }
    try {
      await registerCloudAccount(normalizedHints.apiBaseUrl, normalizedHints.email, password);
      writeAuthHints(normalizedHints);
      setPassword('');
      onSuccess();
    } catch (error) {
      const fallback = '注册失败，请检查输入后重试。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    }
  };

  const handleLogin = async (): Promise<void> => {
    if (!normalizedHints.apiBaseUrl || !normalizedHints.email || !password.trim()) {
      toast.error('请完整填写同步地址、邮箱与密码。');
      return;
    }
    try {
      await loginCloudAccount(normalizedHints.apiBaseUrl, normalizedHints.email, password);
      writeAuthHints(normalizedHints);
      setPassword('');
      onSuccess();
    } catch (error) {
      const fallback = '登录失败，请检查输入后重试。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[136] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/45 bg-[#f1f7ff]/95 p-6 shadow-2xl backdrop-blur-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">私有云同步</p>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">登录 / 注册同步账号</h2>
        <p className="mt-1 text-sm text-slate-600">
          金库解锁成功后可立即连接私有云，实现 Windows 与 macOS 多端同步。
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs text-slate-600" htmlFor="cloud-auth-api-url">
              同步服务地址（HTTPS）
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
              id="cloud-auth-api-url"
              onChange={(event) => setApiBaseUrl(event.target.value)}
              placeholder="https://sync.orbitterm.example"
              type="url"
              value={apiBaseUrl}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-600" htmlFor="cloud-auth-email">
              邮箱账号
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
              id="cloud-auth-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="user@example.com"
              type="email"
              value={email}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-600" htmlFor="cloud-auth-password">
              账号密码
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
              id="cloud-auth-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位"
              type="password"
              value={password}
            />
          </div>
        </div>

        {cloudSyncError ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {cloudSyncError}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSyncingCloud}
            onClick={() => {
              onSkip();
            }}
            type="button"
          >
            跳过（本次）
          </button>
          <button
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSyncingCloud}
            onClick={() => {
              void handleRegister();
            }}
            type="button"
          >
            {isSyncingCloud ? '处理中...' : '注册账号'}
          </button>
          <button
            className="rounded-lg border border-[#2f6df4] bg-[#2f6df4] px-3 py-2 text-xs font-semibold text-white hover:bg-[#245ad0] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSyncingCloud}
            onClick={() => {
              void handleLogin();
            }}
            type="button"
          >
            {isSyncingCloud ? '处理中...' : '登录并同步'}
          </button>
        </div>
      </div>
    </div>
  );
}
