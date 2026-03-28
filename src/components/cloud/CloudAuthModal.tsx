import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  fetchCloudSyncPolicy,
  readCloudSyncPolicy,
  type CloudSyncPolicy
} from '../../services/cloudSync';
import { useHostStore } from '../../store/useHostStore';
import { useI18n } from '../../i18n/useI18n';

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
  const { t } = useI18n();
  const isSyncingCloud = useHostStore((state) => state.isSyncingCloud);
  const cloudSyncError = useHostStore((state) => state.cloudSyncError);
  const registerCloudAccount = useHostStore((state) => state.registerCloudAccount);
  const loginCloudAccount = useHostStore((state) => state.loginCloudAccount);

  const [apiBaseUrl, setApiBaseUrl] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [policy, setPolicy] = useState<CloudSyncPolicy | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const hints = readAuthHints();
    const cachedPolicy = readCloudSyncPolicy();
    setPolicy(cachedPolicy);
    setApiBaseUrl(hints.apiBaseUrl);
    setEmail(hints.email);
    setPassword('');
  }, [open]);

  useEffect(() => {
    if (!open || !policy?.lockSyncDomain || !policy.defaultSyncDomain) {
      return;
    }
    setApiBaseUrl(policy.defaultSyncDomain);
  }, [open, policy]);

  const normalizedHints = useMemo<CloudAuthHints>(() => {
    const effectiveApiBaseUrl =
      policy?.lockSyncDomain && policy.defaultSyncDomain
        ? policy.defaultSyncDomain
        : apiBaseUrl.trim();
    return {
      apiBaseUrl: effectiveApiBaseUrl,
      email: email.trim()
    };
  }, [apiBaseUrl, email, policy]);

  const refreshPolicyByEndpoint = async (endpoint: string): Promise<CloudSyncPolicy | null> => {
    if (!endpoint.trim()) {
      return policy;
    }
    try {
      const nextPolicy = await fetchCloudSyncPolicy(endpoint);
      setPolicy(nextPolicy);
      return nextPolicy;
    } catch (_error) {
      return policy;
    }
  };

  const handleRegister = async (): Promise<void> => {
    if (!normalizedHints.apiBaseUrl || !normalizedHints.email || !password.trim()) {
      toast.error(t('cloud.errorFillRequired'));
      return;
    }
    const latestPolicy = await refreshPolicyByEndpoint(normalizedHints.apiBaseUrl);
    if (latestPolicy?.setupRequired) {
      toast.error(t('cloud.errorSetupRequired'));
      return;
    }
    const effectiveApi =
      latestPolicy?.lockSyncDomain && latestPolicy.defaultSyncDomain
        ? latestPolicy.defaultSyncDomain
        : normalizedHints.apiBaseUrl;
    try {
      await registerCloudAccount(effectiveApi, normalizedHints.email, password);
      writeAuthHints({ ...normalizedHints, apiBaseUrl: effectiveApi });
      setPassword('');
      onSuccess();
    } catch (error) {
      const fallback = t('cloud.errorRegister');
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    }
  };

  const handleLogin = async (): Promise<void> => {
    if (!normalizedHints.apiBaseUrl || !normalizedHints.email || !password.trim()) {
      toast.error(t('cloud.errorFillRequired'));
      return;
    }
    const latestPolicy = await refreshPolicyByEndpoint(normalizedHints.apiBaseUrl);
    if (latestPolicy?.setupRequired) {
      toast.error(t('cloud.errorSetupRequired'));
      return;
    }
    const effectiveApi =
      latestPolicy?.lockSyncDomain && latestPolicy.defaultSyncDomain
        ? latestPolicy.defaultSyncDomain
        : normalizedHints.apiBaseUrl;
    try {
      await loginCloudAccount(effectiveApi, normalizedHints.email, password);
      writeAuthHints({ ...normalizedHints, apiBaseUrl: effectiveApi });
      setPassword('');
      onSuccess();
    } catch (error) {
      const fallback = t('cloud.errorLogin');
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
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t('cloud.tag')}</p>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">{t('cloud.title')}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {t('cloud.desc')}
        </p>
        {policy?.requireActivation ? (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {t('cloud.requireActivation')}
          </p>
        ) : null}

        <div className="mt-4 space-y-3">
          {!policy?.hideSyncDomainInput ? (
            <div>
              <label className="block text-xs text-slate-600" htmlFor="cloud-auth-api-url">
                {t('cloud.syncUrlLabel')}
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300 disabled:cursor-not-allowed disabled:bg-slate-100"
                disabled={policy?.lockSyncDomain === true}
                id="cloud-auth-api-url"
                onBlur={() => {
                  if (apiBaseUrl.trim()) {
                    void refreshPolicyByEndpoint(apiBaseUrl);
                  }
                }}
                onChange={(event) => setApiBaseUrl(event.target.value)}
                placeholder={t('cloud.syncUrlPlaceholder')}
                type="url"
                value={apiBaseUrl}
              />
              {policy?.lockSyncDomain ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  {t('cloud.syncUrlLocked')}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {t('cloud.syncUrlHidden')}
              {policy?.defaultSyncDomain ? ` ${policy.defaultSyncDomain}` : ''}
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-600" htmlFor="cloud-auth-email">
              {t('cloud.emailLabel')}
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
              {t('cloud.passwordLabel')}
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
              id="cloud-auth-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('cloud.passwordPlaceholder')}
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
            {t('cloud.btnSkip')}
          </button>
          <button
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSyncingCloud}
            onClick={() => {
              void handleRegister();
            }}
            type="button"
          >
            {isSyncingCloud ? t('common.processing') : t('cloud.btnRegister')}
          </button>
          <button
            className="rounded-lg border border-[#2f6df4] bg-[#2f6df4] px-3 py-2 text-xs font-semibold text-white hover:bg-[#245ad0] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSyncingCloud}
            onClick={() => {
              void handleLogin();
            }}
            type="button"
          >
            {isSyncingCloud ? t('common.processing') : t('cloud.btnLogin')}
          </button>
        </div>
      </div>
    </div>
  );
}
