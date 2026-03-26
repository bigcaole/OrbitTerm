import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LOYU_THEME_PRESETS } from '../../theme/loyuTheme';
import { useHostStore } from '../../store/useHostStore';
import { useUiSettingsStore } from '../../store/useUiSettingsStore';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenAbout: () => void;
}

const FONT_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  {
    label: 'IBM Plex Mono (推荐)',
    value: 'IBM Plex Mono, Source Code Pro, Inconsolata, Sarasa Mono SC, Menlo, Monaco, monospace'
  },
  {
    label: 'Source Code Pro',
    value: 'Source Code Pro, IBM Plex Mono, Inconsolata, Sarasa Mono SC, Menlo, Monaco, monospace'
  },
  {
    label: 'Fira Code',
    value: 'Fira Code, IBM Plex Mono, Source Code Pro, Inconsolata, Menlo, Monaco, monospace'
  },
  {
    label: 'Inconsolata',
    value: 'Inconsolata, IBM Plex Mono, Source Code Pro, Fira Code, Menlo, Monaco, monospace'
  },
  {
    label: 'JetBrains Mono',
    value: 'JetBrains Mono, IBM Plex Mono, Source Code Pro, Inconsolata, Menlo, Monaco, monospace'
  },
  {
    label: 'Sarasa Mono SC',
    value: 'Sarasa Mono SC, IBM Plex Mono, Source Code Pro, Inconsolata, Menlo, Monaco, monospace'
  },
  {
    label: 'SF Mono',
    value: 'SFMono-Regular, SF Mono, IBM Plex Mono, Source Code Pro, Inconsolata, Menlo, Monaco, monospace'
  }
];

export function SettingsDrawer({
  open,
  onClose,
  onOpenAbout
}: SettingsDrawerProps): JSX.Element | null {
  const terminalFontSize = useUiSettingsStore((state) => state.terminalFontSize);
  const terminalFontFamily = useUiSettingsStore((state) => state.terminalFontFamily);
  const terminalOpacity = useUiSettingsStore((state) => state.terminalOpacity);
  const terminalBlur = useUiSettingsStore((state) => state.terminalBlur);
  const themePresetId = useUiSettingsStore((state) => state.themePresetId);
  const autoLockEnabled = useUiSettingsStore((state) => state.autoLockEnabled);
  const autoLockMinutes = useUiSettingsStore((state) => state.autoLockMinutes);
  const setTerminalFontSize = useUiSettingsStore((state) => state.setTerminalFontSize);
  const setTerminalFontFamily = useUiSettingsStore((state) => state.setTerminalFontFamily);
  const setTerminalOpacity = useUiSettingsStore((state) => state.setTerminalOpacity);
  const setTerminalBlur = useUiSettingsStore((state) => state.setTerminalBlur);
  const setThemePresetId = useUiSettingsStore((state) => state.setThemePresetId);
  const setAutoLockEnabled = useUiSettingsStore((state) => state.setAutoLockEnabled);
  const setAutoLockMinutes = useUiSettingsStore((state) => state.setAutoLockMinutes);
  const cloudSyncSession = useHostStore((state) => state.cloudSyncSession);
  const isSyncingCloud = useHostStore((state) => state.isSyncingCloud);
  const cloudSyncError = useHostStore((state) => state.cloudSyncError);
  const registerCloudAccount = useHostStore((state) => state.registerCloudAccount);
  const loginCloudAccount = useHostStore((state) => state.loginCloudAccount);
  const logoutCloudAccount = useHostStore((state) => state.logoutCloudAccount);
  const syncPullFromCloud = useHostStore((state) => state.syncPullFromCloud);
  const vaultVersion = useHostStore((state) => state.vaultVersion);
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(cloudSyncSession?.apiBaseUrl ?? '');
  const [email, setEmail] = useState<string>(cloudSyncSession?.email ?? '');
  const [password, setPassword] = useState<string>('');

  useEffect(() => {
    if (!cloudSyncSession) {
      return;
    }
    setApiBaseUrl(cloudSyncSession.apiBaseUrl);
    setEmail(cloudSyncSession.email);
  }, [cloudSyncSession]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-black/25 backdrop-blur-[2px]">
      <button
        aria-label="关闭设置"
        className="flex-1 cursor-default"
        onClick={onClose}
        type="button"
      />
      <aside className="h-full w-full max-w-md overflow-y-auto border-l border-white/30 bg-[#f2f7ff]/90 p-5 shadow-2xl backdrop-blur-2xl">
        <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-5 flex items-center justify-between border-b border-white/60 bg-[#f2f7ff]/95 px-5 py-4 backdrop-blur-2xl">
          <h2 className="text-base font-semibold text-slate-900">设置中心</h2>
          <button
            className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-white/70"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <section className="space-y-2 rounded-xl border border-white/60 bg-white/60 p-3">
            <h3 className="text-sm font-semibold text-slate-800">终端字体</h3>
            <label className="block text-xs text-slate-600" htmlFor="terminal-font-family">
              字体家族
            </label>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
              id="terminal-font-family"
              onChange={(event) => setTerminalFontFamily(event.target.value)}
              value={terminalFontFamily}
            >
              {FONT_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500">
              已内置多款开源等宽字体，长时间查看日志时建议优先使用 IBM Plex Mono 或 Source Code Pro。
            </p>

            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>字体大小</span>
              <span>{terminalFontSize}px</span>
            </div>
            <input
              className="w-full accent-[#2f6df4]"
              max={22}
              min={11}
              onChange={(event) => setTerminalFontSize(Number(event.target.value))}
              step={1}
              type="range"
              value={terminalFontSize}
            />
          </section>

          <section className="space-y-2 rounded-xl border border-white/60 bg-white/60 p-3">
            <h3 className="text-sm font-semibold text-slate-800">Acrylic / Blur</h3>
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>终端背景透明度</span>
              <span>{terminalOpacity}%</span>
            </div>
            <input
              className="w-full accent-[#2f6df4]"
              max={100}
              min={50}
              onChange={(event) => setTerminalOpacity(Number(event.target.value))}
              step={1}
              type="range"
              value={terminalOpacity}
            />

            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>磨砂强度</span>
              <span>{terminalBlur}px</span>
            </div>
            <input
              className="w-full accent-[#2f6df4]"
              max={28}
              min={0}
              onChange={(event) => setTerminalBlur(Number(event.target.value))}
              step={1}
              type="range"
              value={terminalBlur}
            />
          </section>

          <section className="space-y-2 rounded-xl border border-white/60 bg-white/60 p-3">
            <h3 className="text-sm font-semibold text-slate-800">主题配色</h3>
            <div className="space-y-2">
              {LOYU_THEME_PRESETS.map((preset) => (
                <button
                  className={`w-full rounded-lg border px-3 py-2 text-left ${
                    preset.id === themePresetId
                      ? 'border-[#2f6df4] bg-[#eaf1ff]'
                      : 'border-white/70 bg-white/80 hover:border-slate-200'
                  }`}
                  key={preset.id}
                  onClick={() => setThemePresetId(preset.id)}
                  type="button"
                >
                  <p className="text-sm font-medium text-slate-800">{preset.name}</p>
                  <p className="mt-0.5 text-xs text-slate-600">{preset.description}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2 rounded-xl border border-white/60 bg-white/60 p-3">
            <h3 className="text-sm font-semibold text-slate-800">安全</h3>
            <label className="flex items-start gap-3">
              <input
                checked={autoLockEnabled}
                className="mt-0.5 h-4 w-4 accent-[#2f6df4]"
                onChange={(event) => setAutoLockEnabled(event.target.checked)}
                type="checkbox"
              />
              <span className="text-xs text-slate-700">App 隐藏或闲置后自动锁定金库（推荐开启）。</span>
            </label>
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>自动锁定时长</span>
                <span>{autoLockMinutes} 分钟</span>
              </div>
              <input
                className="w-full accent-[#2f6df4]"
                disabled={!autoLockEnabled}
                max={120}
                min={1}
                onChange={(event) => setAutoLockMinutes(Number(event.target.value))}
                step={1}
                type="range"
                value={autoLockMinutes}
              />
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-white/60 bg-white/60 p-3">
            <h3 className="text-sm font-semibold text-slate-800">私有云同步</h3>
            <p className="text-xs text-slate-700">
              使用账号登录后，主机金库会在本地变更后自动上传，并在登录时自动拉取云端新版本（仅支持 HTTPS）。
            </p>
            <label className="block text-xs text-slate-600" htmlFor="sync-api-url">
              同步服务地址（HTTPS）
            </label>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
              id="sync-api-url"
              onChange={(event) => setApiBaseUrl(event.target.value)}
              placeholder="https://sync.orbitterm.example"
              type="url"
              value={apiBaseUrl}
            />

            <label className="block text-xs text-slate-600" htmlFor="sync-email">
              邮箱账号
            </label>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
              id="sync-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="user@example.com"
              type="email"
              value={email}
            />

            <label className="block text-xs text-slate-600" htmlFor="sync-password">
              账号密码
            </label>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
              id="sync-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位"
              type="password"
              value={password}
            />

            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSyncingCloud}
                onClick={() => {
                  void registerCloudAccount(apiBaseUrl, email, password)
                    .catch((error) => {
                      const fallback = '注册失败，请检查输入后重试。';
                      const message = error instanceof Error ? error.message : fallback;
                      toast.error(message || fallback);
                    })
                    .finally(() => {
                      setPassword('');
                    });
                }}
                type="button"
              >
                {isSyncingCloud ? '处理中...' : '注册账号'}
              </button>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSyncingCloud}
                onClick={() => {
                  void loginCloudAccount(apiBaseUrl, email, password)
                    .catch((error) => {
                      const fallback = '登录失败，请检查输入后重试。';
                      const message = error instanceof Error ? error.message : fallback;
                      toast.error(message || fallback);
                    })
                    .finally(() => {
                      setPassword('');
                    });
                }}
                type="button"
              >
                {isSyncingCloud ? '处理中...' : '登录并同步'}
              </button>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSyncingCloud || !cloudSyncSession}
                onClick={() => {
                  void syncPullFromCloud()
                    .then(() => {
                      toast.success('已执行云端拉取检查');
                    })
                    .catch((error) => {
                      const fallback = '云端拉取失败，请稍后重试。';
                      const message = error instanceof Error ? error.message : fallback;
                      toast.error(message || fallback);
                    });
                }}
                type="button"
              >
                立即拉取
              </button>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSyncingCloud || !cloudSyncSession}
                onClick={() => {
                  logoutCloudAccount();
                  setPassword('');
                  toast.message('已断开私有云同步账号');
                }}
                type="button"
              >
                退出登录
              </button>
            </div>

            {cloudSyncSession ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                已登录：{cloudSyncSession.email}（本地金库版本：v{vaultVersion ?? '-'}）
              </p>
            ) : (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                当前未登录私有云账号，数据仅保存在本机加密金库。
              </p>
            )}
            {cloudSyncError ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {cloudSyncError}
              </p>
            ) : null}
          </section>

          <section className="space-y-2 rounded-xl border border-white/60 bg-white/60 p-3">
            <h3 className="text-sm font-semibold text-slate-800">关于</h3>
            <p className="text-xs text-slate-700">查看版本信息、开源致谢与新版本下载提示。</p>
            <button
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              onClick={onOpenAbout}
              type="button"
            >
              关于轨连终端
            </button>
          </section>
        </div>
      </aside>
    </div>
  );
}
