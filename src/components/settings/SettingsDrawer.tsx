import { useEffect, useMemo, useState } from 'react';
import { save as saveDialog } from '@tauri-apps/api/dialog';
import { toast } from 'sonner';
import type { AuthMethod, IdentityConfig } from '../../types/host';
import {
  sshDeployPublicKey,
  sshDerivePublicKey,
  sshExportPrivateKey,
  sshGenerateKeypair,
  type SshKeyAlgorithm
} from '../../services/ssh';
import { ORBIT_THEME_PRESETS } from '../../theme/orbitTheme';
import { useHostStore } from '../../store/useHostStore';
import { useUiSettingsStore, type CloseWindowAction } from '../../store/useUiSettingsStore';
import { buildHostKey } from '../../utils/hostKey';
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from '../../i18n/core';
import { useI18n } from '../../i18n/useI18n';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenAbout: () => void;
  activeCategory: SettingsCategory;
  onCategoryChange: (category: SettingsCategory) => void;
  focusSectionId: string | null;
  focusSequence: number;
  activeTerminalSessionId: string | null;
  activeTerminalHostId: string | null;
  activeTerminalTitle: string | null;
  onOpenCloudAuth: () => void;
}

export type SettingsCategory = 'profile' | 'settings' | 'files' | 'other';

const SETTINGS_CATEGORY_OPTIONS: ReadonlyArray<{ id: SettingsCategory }> = [
  { id: 'profile' },
  { id: 'settings' },
  { id: 'files' },
  { id: 'other' }
];

const FONT_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  {
    label: 'JetBrainsMono Nerd Font (图标推荐)',
    value:
      '"JetBrainsMono Nerd Font", "Symbols Nerd Font Mono", "Nerd Font Symbols", "JetBrains Mono", "IBM Plex Mono", "Source Code Pro", Inconsolata, monospace'
  },
  {
    label: 'IBM Plex Mono (推荐)',
    value:
      '"IBM Plex Mono", "Symbols Nerd Font Mono", "Nerd Font Symbols", "JetBrainsMono Nerd Font", "JetBrains Mono", "Source Code Pro", Inconsolata, "Sarasa Mono SC", Menlo, Monaco, monospace'
  },
  {
    label: 'Source Code Pro',
    value:
      '"Source Code Pro", "Symbols Nerd Font Mono", "Nerd Font Symbols", "IBM Plex Mono", "JetBrainsMono Nerd Font", "JetBrains Mono", Inconsolata, "Sarasa Mono SC", Menlo, Monaco, monospace'
  },
  {
    label: 'Fira Code',
    value:
      '"Fira Code", "Symbols Nerd Font Mono", "Nerd Font Symbols", "IBM Plex Mono", "Source Code Pro", "JetBrainsMono Nerd Font", "JetBrains Mono", Inconsolata, Menlo, Monaco, monospace'
  },
  {
    label: 'Inconsolata',
    value:
      'Inconsolata, "Symbols Nerd Font Mono", "Nerd Font Symbols", "IBM Plex Mono", "Source Code Pro", "JetBrainsMono Nerd Font", "JetBrains Mono", "Fira Code", Menlo, Monaco, monospace'
  },
  {
    label: 'JetBrains Mono',
    value:
      '"JetBrains Mono", "Symbols Nerd Font Mono", "Nerd Font Symbols", "JetBrainsMono Nerd Font", "IBM Plex Mono", "Source Code Pro", Inconsolata, Menlo, Monaco, monospace'
  },
  {
    label: 'Sarasa Mono SC',
    value:
      '"Sarasa Mono SC", "Symbols Nerd Font Mono", "Nerd Font Symbols", "IBM Plex Mono", "Source Code Pro", Inconsolata, "JetBrainsMono Nerd Font", "JetBrains Mono", Menlo, Monaco, monospace'
  },
  {
    label: 'SF Mono',
    value:
      'SFMono-Regular, "SF Mono", "Symbols Nerd Font Mono", "Nerd Font Symbols", "IBM Plex Mono", "Source Code Pro", Inconsolata, Menlo, Monaco, monospace'
  }
];

export function SettingsDrawer({
  open,
  onClose,
  onOpenAbout,
  activeCategory,
  onCategoryChange,
  focusSectionId,
  focusSequence,
  activeTerminalSessionId,
  activeTerminalHostId,
  activeTerminalTitle,
  onOpenCloudAuth
}: SettingsDrawerProps): JSX.Element | null {
  const { t } = useI18n();
  const terminalFontSize = useUiSettingsStore((state) => state.terminalFontSize);
  const terminalFontFamily = useUiSettingsStore((state) => state.terminalFontFamily);
  const terminalOpacity = useUiSettingsStore((state) => state.terminalOpacity);
  const terminalBlur = useUiSettingsStore((state) => state.terminalBlur);
  const acrylicBlur = useUiSettingsStore((state) => state.acrylicBlur);
  const acrylicSaturation = useUiSettingsStore((state) => state.acrylicSaturation);
  const acrylicBrightness = useUiSettingsStore((state) => state.acrylicBrightness);
  const themePresetId = useUiSettingsStore((state) => state.themePresetId);
  const autoLockEnabled = useUiSettingsStore((state) => state.autoLockEnabled);
  const autoLockMinutes = useUiSettingsStore((state) => state.autoLockMinutes);
  const closeWindowAction = useUiSettingsStore((state) => state.closeWindowAction);
  const language = useUiSettingsStore((state) => state.language);
  const setTerminalFontSize = useUiSettingsStore((state) => state.setTerminalFontSize);
  const setTerminalFontFamily = useUiSettingsStore((state) => state.setTerminalFontFamily);
  const setTerminalOpacity = useUiSettingsStore((state) => state.setTerminalOpacity);
  const setTerminalBlur = useUiSettingsStore((state) => state.setTerminalBlur);
  const setAcrylicBlur = useUiSettingsStore((state) => state.setAcrylicBlur);
  const setAcrylicSaturation = useUiSettingsStore((state) => state.setAcrylicSaturation);
  const setAcrylicBrightness = useUiSettingsStore((state) => state.setAcrylicBrightness);
  const setThemePresetId = useUiSettingsStore((state) => state.setThemePresetId);
  const setAutoLockEnabled = useUiSettingsStore((state) => state.setAutoLockEnabled);
  const setAutoLockMinutes = useUiSettingsStore((state) => state.setAutoLockMinutes);
  const setCloseWindowAction = useUiSettingsStore((state) => state.setCloseWindowAction);
  const setLanguage = useUiSettingsStore((state) => state.setLanguage);
  const cloudSyncSession = useHostStore((state) => state.cloudSyncSession);
  const cloudSyncPolicy = useHostStore((state) => state.cloudSyncPolicy);
  const cloudLicenseStatus = useHostStore((state) => state.cloudLicenseStatus);
  const isActivatingCloudLicense = useHostStore((state) => state.isActivatingCloudLicense);
  const isSyncingCloud = useHostStore((state) => state.isSyncingCloud);
  const cloudSyncError = useHostStore((state) => state.cloudSyncError);
  const identities = useHostStore((state) => state.identities);
  const hosts = useHostStore((state) => state.hosts);
  const isSavingVault = useHostStore((state) => state.isSavingVault);
  const addIdentity = useHostStore((state) => state.addIdentity);
  const updateIdentity = useHostStore((state) => state.updateIdentity);
  const logoutCloudAccount = useHostStore((state) => state.logoutCloudAccount);
  const refreshCloudLicenseStatus = useHostStore((state) => state.refreshCloudLicenseStatus);
  const activateCloudLicenseCode = useHostStore((state) => state.activateCloudLicenseCode);
  const syncPullFromCloud = useHostStore((state) => state.syncPullFromCloud);
  const vaultVersion = useHostStore((state) => state.vaultVersion);
  const cloudDevices = useHostStore((state) => state.cloudDevices);
  const isLoadingCloudDevices = useHostStore((state) => state.isLoadingCloudDevices);
  const loadCloudDevices = useHostStore((state) => state.loadCloudDevices);
  const revokeCloudDevice = useHostStore((state) => state.revokeCloudDevice);
  const revokeAllCloudDevices = useHostStore((state) => state.revokeAllCloudDevices);
  const [identityMode, setIdentityMode] = useState<'new' | 'existing'>('new');
  const [selectedIdentityId, setSelectedIdentityId] = useState<string>('');
  const [identityNameInput, setIdentityNameInput] = useState<string>('');
  const [identityUsernameInput, setIdentityUsernameInput] = useState<string>('root');
  const [keyAlgorithm, setKeyAlgorithm] = useState<SshKeyAlgorithm>('ed25519');
  const [isGeneratingKey, setIsGeneratingKey] = useState<boolean>(false);
  const [isDeployingKey, setIsDeployingKey] = useState<boolean>(false);
  const [isExportingKey, setIsExportingKey] = useState<boolean>(false);
  const [licenseCodeInput, setLicenseCodeInput] = useState<string>('');

  useEffect(() => {
    if (!open || !cloudSyncSession) {
      return;
    }
    void loadCloudDevices();
    void refreshCloudLicenseStatus();
  }, [cloudSyncSession, loadCloudDevices, open]);

  useEffect(() => {
    if (identities.length === 0) {
      setSelectedIdentityId('');
      return;
    }
    if (!selectedIdentityId || !identities.some((item) => item.id === selectedIdentityId)) {
      setSelectedIdentityId(identities[0]?.id ?? '');
    }
  }, [identities, selectedIdentityId]);

  const selectedIdentity = useMemo(() => {
    if (!selectedIdentityId) {
      return null;
    }
    return identities.find((identity) => identity.id === selectedIdentityId) ?? null;
  }, [identities, selectedIdentityId]);

  useEffect(() => {
    if (identityMode !== 'existing' || !selectedIdentity) {
      return;
    }
    setIdentityNameInput(selectedIdentity.name);
    setIdentityUsernameInput(selectedIdentity.username);
  }, [identityMode, selectedIdentity]);

  const activeHost = useMemo(() => {
    if (!activeTerminalHostId) {
      return null;
    }
    return hosts.find((host) => buildHostKey(host) === activeTerminalHostId) ?? null;
  }, [activeTerminalHostId, hosts]);

  const activeSessionIdentity = useMemo(() => {
    if (!activeHost) {
      return null;
    }
    return identities.find((identity) => identity.id === activeHost.identityId) ?? null;
  }, [activeHost, identities]);

  const canDeployByPasswordSession = useMemo(() => {
    return Boolean(activeTerminalSessionId && activeSessionIdentity?.authConfig.method === 'password');
  }, [activeSessionIdentity, activeTerminalSessionId]);

  const accountDisplay = useMemo(() => {
    if (!cloudSyncSession?.email) {
      return t('settings.offlineMode');
    }
    return cloudSyncSession.email;
  }, [cloudSyncSession, t]);

  const accountAvatar = useMemo(() => {
    const source = cloudSyncSession?.email?.trim();
    if (!source) {
      return 'OT';
    }
    return source.slice(0, 2).toUpperCase();
  }, [cloudSyncSession]);

  const showProfileCategory = activeCategory === 'profile';
  const showSettingsCategory = activeCategory === 'settings';
  const showFilesCategory = activeCategory === 'files';
  const showOtherCategory = activeCategory === 'other';

  const formatRelativeOnline = (isoText: string): string => {
    const date = new Date(isoText);
    if (Number.isNaN(date.getTime())) {
      return '未知在线时间';
    }
    const diffMs = Date.now() - date.getTime();
    if (diffMs < 60_000) {
      return '刚刚在线';
    }
    if (diffMs < 3_600_000) {
      return `${Math.floor(diffMs / 60_000)} 分钟前在线`;
    }
    if (diffMs < 86_400_000) {
      return `${Math.floor(diffMs / 3_600_000)} 小时前在线`;
    }
    return `${Math.floor(diffMs / 86_400_000)} 天前在线`;
  };

  const authMethodLabel = (method: AuthMethod): string => {
    return method === 'password' ? '密码认证' : '私钥认证';
  };

  const closeWindowActionLabel = (value: CloseWindowAction): string => {
    if (value === 'tray') {
      return '关闭后驻留系统托盘';
    }
    if (value === 'exit') {
      return '关闭后直接退出';
    }
    return '每次关闭都询问';
  };

  const licenseSummary = useMemo(() => {
    if (!cloudSyncSession) {
      return '未登录';
    }
    if (!cloudLicenseStatus) {
      return '授权状态待刷新';
    }
    if (!cloudLicenseStatus.active) {
      return '未激活（仅本地可用）';
    }
    if (cloudLicenseStatus.isLifetime) {
      return '已激活（永久）';
    }
    if (cloudLicenseStatus.expiresAt) {
      return `已激活（到期：${cloudLicenseStatus.expiresAt}）`;
    }
    return '已激活';
  }, [cloudLicenseStatus, cloudSyncSession]);

  useEffect(() => {
    if (!open || !focusSectionId) {
      return;
    }
    let attempts = 0;
    const maxAttempts = 10;
    const tryScroll = (): void => {
      const target = document.getElementById(focusSectionId);
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) {
        window.setTimeout(tryScroll, 45);
      }
    };
    window.setTimeout(tryScroll, 20);
  }, [focusSectionId, focusSequence, open, activeCategory]);

  const handleGenerateIdentityKeypair = async (): Promise<void> => {
    const normalizedName = identityNameInput.trim();
    const normalizedUsername = identityUsernameInput.trim();
    if (!normalizedUsername) {
      toast.error('请输入身份用户名。');
      return;
    }
    if (identityMode === 'existing' && !selectedIdentity) {
      toast.error('请选择一个已有身份。');
      return;
    }

    setIsGeneratingKey(true);
    try {
      const comment = `${normalizedUsername}@orbitterm`;
      const generated = await sshGenerateKeypair(keyAlgorithm, comment);
      const authConfig = {
        method: 'privateKey' as const,
        password: '',
        privateKey: generated.privateKey,
        passphrase: ''
      };

      if (identityMode === 'existing' && selectedIdentity) {
        const nextIdentity: IdentityConfig = {
          ...selectedIdentity,
          name: normalizedName || selectedIdentity.name,
          username: normalizedUsername,
          authConfig
        };
        await updateIdentity(nextIdentity);
        toast.success(`已为身份「${nextIdentity.name}」生成新密钥`, {
          description: generated.fingerprint
        });
        return;
      }

      const created = await addIdentity({
        name: normalizedName || `${normalizedUsername}@identity`,
        username: normalizedUsername,
        authConfig
      });
      setIdentityMode('existing');
      setSelectedIdentityId(created.id);
      toast.success(`已创建身份「${created.name}」并写入新密钥`, {
        description: generated.fingerprint
      });
    } catch (error) {
      const fallback = '生成密钥失败，请稍后重试。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    } finally {
      setIsGeneratingKey(false);
    }
  };

  const handleDeployPublicKey = async (identity: IdentityConfig): Promise<void> => {
    const privateKey = identity.authConfig.privateKey?.trim() ?? '';
    if (!privateKey) {
      toast.error('当前身份未配置私钥，无法部署公钥。');
      return;
    }
    if (!activeTerminalSessionId) {
      toast.error('请先连接并激活一个终端会话。');
      return;
    }
    if (!canDeployByPasswordSession) {
      toast.error('请先使用“密码认证”会话连接目标主机，再执行公钥部署。');
      return;
    }

    setIsDeployingKey(true);
    try {
      const derived = await sshDerivePublicKey(privateKey);
      await sshDeployPublicKey(activeTerminalSessionId, derived.publicKey);
      toast.success(`公钥已部署到当前会话主机：${activeTerminalTitle ?? '当前会话'}`, {
        description: derived.fingerprint
      });
    } catch (error) {
      const fallback = '部署公钥失败，请检查远端权限后重试。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    } finally {
      setIsDeployingKey(false);
    }
  };

  const handleExportPrivateKey = async (identity: IdentityConfig): Promise<void> => {
    const privateKey = identity.authConfig.privateKey?.trim() ?? '';
    if (!privateKey) {
      toast.error('当前身份未配置私钥，无法导出。');
      return;
    }

    const fileSafeName = identity.name.replace(/[^\w\u4e00-\u9fa5-]+/g, '-');
    const selectedPath = await saveDialog({
      defaultPath: `${fileSafeName || 'orbitterm-identity'}.pem`
    });
    if (!selectedPath || Array.isArray(selectedPath)) {
      return;
    }

    setIsExportingKey(true);
    try {
      const result = await sshExportPrivateKey(privateKey, selectedPath);
      toast.success('私钥导出成功', {
        description: `${result.path}（${result.bytes} bytes）`
      });
    } catch (error) {
      const fallback = '私钥导出失败，请检查目标目录权限。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    } finally {
      setIsExportingKey(false);
    }
  };

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
          <h2 className="text-base font-semibold text-slate-900">{t('settings.centerTitle')}</h2>
          <button
            className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-white/70"
            onClick={onClose}
            type="button"
          >
            {t('common.close')}
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <section className="rounded-xl border border-[#bfd5f7] bg-[#e9f2ff] p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#8ab1e8] bg-[#2a5b9f] text-sm font-semibold text-white">
                {accountAvatar}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{accountDisplay}</p>
                <p className="text-[11px] text-slate-600">
                  {cloudSyncSession ? t('settings.cloudLoggedIn') : t('settings.cloudNotLoggedIn')}
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {SETTINGS_CATEGORY_OPTIONS.map((item) => (
                <button
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                    activeCategory === item.id
                      ? 'border-[#2f6df4] bg-[#dce9ff] text-[#1f4e8f]'
                      : 'border-[#c2d6f2] bg-white/85 text-slate-700 hover:bg-white'
                  }`}
                  key={item.id}
                  onClick={() => onCategoryChange(item.id)}
                  type="button"
                >
                  {t(`settings.category.${item.id}`)}
                </button>
              ))}
            </div>
          </section>

          {showSettingsCategory && (
            <section
            className="scroll-mt-20 space-y-2 rounded-xl border border-white/60 bg-white/60 p-3"
            id="settings-font"
          >
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
              已补齐 Nerd Font 符号回退链。若系统已安装 JetBrainsMono Nerd Font，文件夹/Git 分支图标会优先以原生 Nerd 字形渲染。
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
          )}

          {showSettingsCategory && (
            <section
            className="scroll-mt-20 space-y-2 rounded-xl border border-white/60 bg-white/60 p-3"
            id="settings-acrylic"
          >
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

            <div className="mt-3 rounded-lg border border-slate-200 bg-white/70 p-2.5">
              <p className="text-[11px] font-semibold text-slate-700">全局毛玻璃微调（赛博质感）</p>

              <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                <span>全局模糊</span>
                <span>{acrylicBlur}px</span>
              </div>
              <input
                className="w-full accent-[#2f6df4]"
                max={48}
                min={0}
                onChange={(event) => setAcrylicBlur(Number(event.target.value))}
                step={1}
                type="range"
                value={acrylicBlur}
              />

              <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                <span>饱和度</span>
                <span>{acrylicSaturation}%</span>
              </div>
              <input
                className="w-full accent-[#2f6df4]"
                max={220}
                min={60}
                onChange={(event) => setAcrylicSaturation(Number(event.target.value))}
                step={1}
                type="range"
                value={acrylicSaturation}
              />

              <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                <span>亮度</span>
                <span>{acrylicBrightness}%</span>
              </div>
              <input
                className="w-full accent-[#2f6df4]"
                max={150}
                min={70}
                onChange={(event) => setAcrylicBrightness(Number(event.target.value))}
                step={1}
                type="range"
                value={acrylicBrightness}
              />
            </div>
            </section>
          )}

          {showSettingsCategory && (
            <section
            className="scroll-mt-20 space-y-2 rounded-xl border border-white/60 bg-white/60 p-3"
            id="settings-theme"
          >
            <h3 className="text-sm font-semibold text-slate-800">主题配色</h3>
            <div className="space-y-2">
              {ORBIT_THEME_PRESETS.map((preset) => (
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
          )}

          {showSettingsCategory && (
            <section className="space-y-2 rounded-xl border border-white/60 bg-white/60 p-3">
              <h3 className="text-sm font-semibold text-slate-800">{t('settings.languageTitle')}</h3>
              <p className="text-xs text-slate-600">{t('settings.languageDesc')}</p>
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
                onChange={(event) => {
                  setLanguage(event.target.value as AppLanguage);
                }}
                value={language}
              >
                {APP_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </section>
          )}

          {showSettingsCategory && (
            <section
            className="scroll-mt-20 space-y-2 rounded-xl border border-white/60 bg-white/60 p-3"
            id="settings-security"
          >
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

            <div className="space-y-1.5 pt-2">
              <label className="text-xs text-slate-600" htmlFor="close-window-action">
                点击窗口关闭按钮时
              </label>
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
                id="close-window-action"
                onChange={(event) => {
                  setCloseWindowAction(event.target.value as CloseWindowAction);
                }}
                value={closeWindowAction}
              >
                <option value="ask">每次关闭都询问（推荐）</option>
                <option value="tray">默认驻留系统托盘</option>
                <option value="exit">默认直接退出</option>
              </select>
              <p className="text-[11px] text-slate-500">
                当前策略：{closeWindowActionLabel(closeWindowAction)}
              </p>
            </div>
            </section>
          )}

          {showFilesCategory && (
            <section
            className="scroll-mt-20 space-y-3 rounded-xl border border-white/60 bg-white/60 p-3"
            id="settings-identity"
          >
            <h3 className="text-sm font-semibold text-slate-800">身份管理 · SSH 密钥</h3>
            <p className="text-xs text-slate-700">
              生成的新密钥会立即写入本地 E2EE 金库，并通过现有云同步链路自动上传。
            </p>

            <div className="rounded-lg border border-slate-200 bg-white/80 p-3">
              <p className="text-xs font-semibold text-slate-700">生成新密钥对</p>
              <div className="mt-2 flex items-center gap-4 text-xs text-slate-700">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    checked={identityMode === 'new'}
                    className="h-3.5 w-3.5 accent-[#2f6df4]"
                    onChange={() => setIdentityMode('new')}
                    type="radio"
                  />
                  新建身份
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    checked={identityMode === 'existing'}
                    className="h-3.5 w-3.5 accent-[#2f6df4]"
                    onChange={() => setIdentityMode('existing')}
                    type="radio"
                  />
                  更新已有身份
                </label>
              </div>

              {identityMode === 'existing' && (
                <div className="mt-2 space-y-1.5">
                  <label className="text-xs text-slate-600" htmlFor="key-target-identity">
                    目标身份
                  </label>
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
                    id="key-target-identity"
                    onChange={(event) => setSelectedIdentityId(event.target.value)}
                    value={selectedIdentityId}
                  >
                    {identities.map((identity) => (
                      <option key={identity.id} value={identity.id}>
                        {identity.name} ({identity.username})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-600" htmlFor="key-identity-name">
                    身份名称
                  </label>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
                    id="key-identity-name"
                    onChange={(event) => setIdentityNameInput(event.target.value)}
                    placeholder="例如：生产服务器密钥"
                    value={identityNameInput}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-600" htmlFor="key-identity-username">
                    登录用户名
                  </label>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
                    id="key-identity-username"
                    onChange={(event) => setIdentityUsernameInput(event.target.value)}
                    placeholder="例如：root"
                    value={identityUsernameInput}
                  />
                </div>
              </div>

              <div className="mt-2 space-y-1.5">
                <label className="text-xs text-slate-600" htmlFor="key-algorithm">
                  密钥算法
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
                  id="key-algorithm"
                  onChange={(event) => setKeyAlgorithm(event.target.value as SshKeyAlgorithm)}
                  value={keyAlgorithm}
                >
                  <option value="ed25519">Ed25519（推荐，轻量安全）</option>
                  <option value="rsa4096">RSA 4096（兼容优先）</option>
                </select>
              </div>

              <button
                className="mt-3 rounded-lg border border-[#2f6df4] bg-[#2f6df4] px-3 py-2 text-xs font-semibold text-white hover:bg-[#245ad0] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isGeneratingKey || isSavingVault}
                onClick={() => {
                  void handleGenerateIdentityKeypair();
                }}
                type="button"
              >
                {isGeneratingKey ? '生成中...' : '生成新密钥对并保存到金库'}
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white/80 p-3">
              <p className="text-xs font-semibold text-slate-700">已有身份密钥</p>
              <p className="mt-1 text-[11px] text-slate-500">
                一键部署要求当前激活会话为密码认证。当前会话：
                {activeTerminalTitle ?? '未连接'}
                {activeSessionIdentity
                  ? `（${authMethodLabel(activeSessionIdentity.authConfig.method)}）`
                  : ''}
              </p>
              <div className="mt-2 max-h-52 space-y-2 overflow-auto pr-1">
                {identities.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500">
                    暂无身份配置，请先生成一个身份密钥。
                  </p>
                ) : (
                  identities.map((identity) => {
                    const hasPrivateKey =
                      identity.authConfig.method === 'privateKey' &&
                      (identity.authConfig.privateKey?.trim().length ?? 0) > 0;
                    return (
                      <div
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                        key={identity.id}
                      >
                        <p className="text-xs font-medium text-slate-800">
                          {identity.name} ({identity.username})
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          认证方式：{authMethodLabel(identity.authConfig.method)}
                        </p>
                        {hasPrivateKey ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={
                                isDeployingKey ||
                                !activeTerminalSessionId ||
                                !canDeployByPasswordSession
                              }
                              onClick={() => {
                                void handleDeployPublicKey(identity);
                              }}
                              type="button"
                            >
                              {isDeployingKey ? '部署中...' : '部署公钥到当前会话主机'}
                            </button>
                            <button
                              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={isExportingKey}
                              onClick={() => {
                                void handleExportPrivateKey(identity);
                              }}
                              type="button"
                            >
                              {isExportingKey ? '导出中...' : '导出私钥'}
                            </button>
                          </div>
                        ) : (
                          <p className="mt-2 text-[11px] text-amber-700">
                            当前身份不是私钥认证，无法部署或导出私钥。
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            </section>
          )}

          {showProfileCategory && (
            <section
            className="scroll-mt-20 space-y-3 rounded-xl border border-white/60 bg-white/60 p-3"
            id="settings-sync"
          >
            <h3 className="text-sm font-semibold text-slate-800">私有云同步</h3>
            <p className="text-xs text-slate-700">
              登录入口已迁移到“解锁后弹层”。这里仅展示同步状态、手动拉取与退出账号。
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSyncingCloud}
                onClick={() => {
                  onOpenCloudAuth();
                }}
                type="button"
              >
                {cloudSyncSession ? '切换账号' : '连接账号'}
              </button>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSyncingCloud || !cloudSyncSession}
                onClick={() => {
                  void syncPullFromCloud({ source: 'manual', force: true })
                    .then(() => {
                      const latestError = useHostStore.getState().cloudSyncError;
                      if (latestError) {
                        toast.error(latestError);
                        return;
                      }
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
                  toast.message('已断开私有云同步账号');
                }}
                type="button"
              >
                退出登录
              </button>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSyncingCloud || !cloudSyncSession}
                onClick={() => {
                  void refreshCloudLicenseStatus();
                }}
                type="button"
              >
                刷新授权
              </button>
            </div>

            {cloudSyncSession ? (
              <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                <p>已登录：{cloudSyncSession.email}（本地金库版本：v{vaultVersion ?? '-'}）</p>
                <p className="text-emerald-800/90">同步服务：{cloudSyncSession.apiBaseUrl}</p>
                <p className="text-emerald-900/90">同步授权：{licenseSummary}</p>
                {cloudSyncPolicy?.lockSyncDomain ? (
                  <p className="text-emerald-900/90">
                    域名策略：已锁定{cloudSyncPolicy.hideSyncDomainInput ? '（并隐藏输入）' : ''}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                当前未登录私有云账号，数据仅保存在本机加密金库。你也可以先“跳过”，后续随时再登录同步。
              </p>
            )}
            {cloudSyncError ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {cloudSyncError}
              </p>
            ) : null}
            {cloudSyncSession && cloudSyncPolicy?.requireActivation !== false && (
              <div className="rounded-lg border border-[#cad9f8] bg-[#f4f8ff] px-3 py-3">
                <p className="text-xs font-semibold text-slate-800">同步激活码</p>
                <p className="mt-1 text-[11px] text-slate-600">
                  注册/登录后请输入购买的激活码以开通云同步服务。
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-blue-300"
                    onChange={(event) => {
                      setLicenseCodeInput(event.target.value);
                    }}
                    placeholder="例如：OT-MONTH-XXXXXXXX-XXXXXXXX"
                    type="text"
                    value={licenseCodeInput}
                  />
                  <button
                    className="rounded-lg border border-[#2f6df4] bg-[#2f6df4] px-3 py-2 text-xs font-semibold text-white hover:bg-[#245ad0] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isActivatingCloudLicense}
                    onClick={() => {
                      void activateCloudLicenseCode(licenseCodeInput)
                        .then(() => {
                          setLicenseCodeInput('');
                          void refreshCloudLicenseStatus();
                        })
                        .catch((error) => {
                          const fallback = '激活失败，请稍后重试。';
                          const message = error instanceof Error ? error.message : fallback;
                          toast.error(message || fallback);
                        });
                    }}
                    type="button"
                  >
                    {isActivatingCloudLicense ? '激活中...' : '激活'}
                  </button>
                </div>
              </div>
            )}
            </section>
          )}

          {showProfileCategory && (
            <section
            className="scroll-mt-20 space-y-3 rounded-xl border border-white/60 bg-white/60 p-3"
            id="settings-devices"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">账号 · 登录设备管理</h3>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!cloudSyncSession || isLoadingCloudDevices}
                onClick={() => {
                  void loadCloudDevices();
                }}
                type="button"
              >
                {isLoadingCloudDevices ? '加载中...' : '刷新列表'}
              </button>
            </div>
            {!cloudSyncSession ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                请先在上方登录私有云账号，才能查看设备列表。
              </p>
            ) : (
              <>
                <div className="max-h-56 space-y-2 overflow-auto pr-1">
                  {cloudDevices.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500">
                      暂无设备记录。
                    </p>
                  ) : (
                    cloudDevices.map((device) => (
                      <div
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                        key={device.id}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-slate-800">
                            {device.deviceName} - {device.deviceLocation} -{' '}
                            {formatRelativeOnline(device.lastSeenAt)}
                          </p>
                          {device.isCurrent ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                              当前设备
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">{device.userAgent}</p>
                        <div className="mt-2 flex justify-end">
                          <button
                            className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={isLoadingCloudDevices}
                            onClick={() => {
                              void revokeCloudDevice(device.id).catch((error) => {
                                const fallback = '退出设备失败，请稍后重试。';
                                const message = error instanceof Error ? error.message : fallback;
                                toast.error(message || fallback);
                              });
                            }}
                            type="button"
                          >
                            {device.isCurrent ? '退出当前设备' : '退出此设备'}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <button
                  className="rounded-lg border border-rose-400 bg-rose-100 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isLoadingCloudDevices || cloudDevices.length === 0}
                  onClick={() => {
                    void revokeAllCloudDevices().catch((error) => {
                      const fallback = '退出所有设备失败，请稍后重试。';
                      const message = error instanceof Error ? error.message : fallback;
                      toast.error(message || fallback);
                    });
                  }}
                  type="button"
                >
                  退出所有设备
                </button>
              </>
            )}
            </section>
          )}

          {showOtherCategory && (
            <section
            className="scroll-mt-20 space-y-2 rounded-xl border border-white/60 bg-white/60 p-3"
            id="settings-about"
          >
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
          )}

          {!showProfileCategory && !showSettingsCategory && !showFilesCategory && !showOtherCategory && (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white/70 px-3 py-2 text-xs text-slate-500">
              未识别分类，请重新选择。
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
