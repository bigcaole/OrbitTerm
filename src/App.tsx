import { useEffect, useMemo, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { save as saveDialog } from '@tauri-apps/api/dialog';
import { relaunch } from '@tauri-apps/api/process';
import { Toaster, toast } from 'sonner';
import { Step1 } from './components/wizard/Step1';
import { Step2 } from './components/wizard/Step2';
import { Step3 } from './components/wizard/Step3';
import { StepIndicator } from './components/wizard/StepIndicator';
import { UnlockScreen } from './components/UnlockScreen';
import { FirstRunOnboarding } from './components/FirstRunOnboarding';
import { HostEditDialog, type HostEditFormValues } from './components/HostEditDialog';
import { LoyuTerminal } from './components/terminal/LoyuTerminal';
import { LoyuAiAssistant } from './components/terminal/LoyuAiAssistant';
import { LoyuInspector } from './components/terminal/LoyuInspector';
import { SftpManager } from './components/sftp/SftpManager';
import { AboutLoyuModal } from './components/settings/AboutLoyuModal';
import { SettingsDrawer } from './components/settings/SettingsDrawer';
import { useHostStore } from './store/useHostStore';
import { useUiSettingsStore } from './store/useUiSettingsStore';
import { aiExplainSshError } from './services/ai';
import type { HealthCheckResponse, SshDiagnosticLogEvent } from './services/inspector';
import { runHealthCheck } from './services/inspector';
import { sshQueryPwd, sshWrite } from './services/ssh';
import { exportEncryptedBackup } from './services/vault';
import { getAppVersion } from './services/appInfo';
import { checkForUpdate, installAvailableUpdate } from './services/updater';
import { resolveThemePreset } from './theme/loyuTheme';
import { buildHostKey } from './utils/hostKey';

type DashboardSection = 'hosts' | 'terminal';

interface SftpSyncRequest {
  sessionId: string;
  path: string;
  nonce: number;
}

const toolbarButtonClass =
  'rounded-lg border border-white/80 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-55';

function App(): JSX.Element {
  const [isAiAssistantOpen, setIsAiAssistantOpen] = useState<boolean>(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isAboutOpen, setIsAboutOpen] = useState<boolean>(false);
  const [dashboardSection, setDashboardSection] = useState<DashboardSection>('hosts');
  const [isHostWizardOpen, setIsHostWizardOpen] = useState<boolean>(false);
  const [isNewTabModalOpen, setIsNewTabModalOpen] = useState<boolean>(false);
  const [selectedTabHostId, setSelectedTabHostId] = useState<string>('');
  const [isQuickUpdating, setIsQuickUpdating] = useState<boolean>(false);
  const [editingHostId, setEditingHostId] = useState<string | null>(null);
  const [isSyncingPath, setIsSyncingPath] = useState<boolean>(false);
  const [sftpSyncRequest, setSftpSyncRequest] = useState<SftpSyncRequest | null>(null);
  const [isSftpCollapsed, setIsSftpCollapsed] = useState<boolean>(false);
  const [reconnectMessage, setReconnectMessage] = useState<string | null>(null);
  const [sshDiagnosticLogs, setSshDiagnosticLogs] = useState<SshDiagnosticLogEvent[]>([]);
  const [healthReport, setHealthReport] = useState<HealthCheckResponse | null>(null);

  const appView = useHostStore((state) => state.appView);
  const hosts = useHostStore((state) => state.hosts);
  const identities = useHostStore((state) => state.identities);
  const activeSessions = useHostStore((state) => state.activeSessions);
  const activeSessionId = useHostStore((state) => state.activeSessionId);
  const isConnectingTerminal = useHostStore((state) => state.isConnectingTerminal);
  const terminalError = useHostStore((state) => state.terminalError);
  const openTerminal = useHostStore((state) => state.openTerminal);
  const setActiveSession = useHostStore((state) => state.setActiveSession);
  const closeSession = useHostStore((state) => state.closeSession);
  const handleSessionClosed = useHostStore((state) => state.handleSessionClosed);
  const closeTerminal = useHostStore((state) => state.closeTerminal);
  const setTerminalError = useHostStore((state) => state.setTerminalError);
  const currentStep = useHostStore((state) => state.currentStep);
  const submittedHost = useHostStore((state) => state.submittedHost);
  const isSavingVault = useHostStore((state) => state.isSavingVault);
  const saveError = useHostStore((state) => state.saveError);
  const reset = useHostStore((state) => state.reset);
  const lockVault = useHostStore((state) => state.lockVault);
  const updateHostAndIdentity = useHostStore((state) => state.updateHostAndIdentity);
  const deleteHost = useHostStore((state) => state.deleteHost);

  const terminalFontSize = useUiSettingsStore((state) => state.terminalFontSize);
  const terminalFontFamily = useUiSettingsStore((state) => state.terminalFontFamily);
  const terminalOpacity = useUiSettingsStore((state) => state.terminalOpacity);
  const terminalBlur = useUiSettingsStore((state) => state.terminalBlur);
  const themePresetId = useUiSettingsStore((state) => state.themePresetId);
  const autoLockEnabled = useUiSettingsStore((state) => state.autoLockEnabled);
  const hasCompletedOnboarding = useUiSettingsStore((state) => state.hasCompletedOnboarding);

  const activeThemePreset = useMemo(() => resolveThemePreset(themePresetId), [themePresetId]);

  const editingHost = useMemo(() => {
    if (!editingHostId) {
      return null;
    }
    return hosts.find((host) => buildHostKey(host) === editingHostId) ?? null;
  }, [editingHostId, hosts]);

  const editingIdentity = useMemo(() => {
    if (!editingHost) {
      return null;
    }
    return identities.find((identity) => identity.id === editingHost.identityId) ?? null;
  }, [editingHost, identities]);

  const editingLinkedHostCount = useMemo(() => {
    if (!editingIdentity) {
      return 0;
    }
    return hosts.filter((host) => host.identityId === editingIdentity.id).length;
  }, [editingIdentity, hosts]);

  const selectedTabHost = useMemo(() => {
    if (!selectedTabHostId) {
      return null;
    }
    return hosts.find((host) => buildHostKey(host) === selectedTabHostId) ?? null;
  }, [hosts, selectedTabHostId]);
  const previousSessionCountRef = useRef<number>(activeSessions.length);

  useEffect(() => {
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, []);

  useEffect(() => {
    document.body.style.background = activeThemePreset.bodyBackground;
  }, [activeThemePreset.bodyBackground]);

  const performHealthCheck = async (showOkToast: boolean): Promise<void> => {
    try {
      const report = await runHealthCheck();
      setHealthReport(report);
      const issues = report.items.filter((item) => item.status !== 'ok');
      if (issues.length > 0) {
        const firstIssue = issues[0];
        if (!firstIssue) {
          return;
        }
        toast.warning(`环境检测异常：${firstIssue.label}`, {
          description: firstIssue.suggestion ?? firstIssue.message
        });
      } else if (showOkToast) {
        toast.success('环境健康检查通过');
      }
    } catch (error) {
      const fallback = '环境健康检查失败，请检查系统权限或网络。';
      const message = error instanceof Error ? error.message : fallback;
      toast.warning(message || fallback);
    }
  };

  useEffect(() => {
    void performHealthCheck(false);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const hasModifier = event.metaKey || event.ctrlKey;
      if (!hasModifier) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 't') {
        event.preventDefault();
        setIsNewTabModalOpen(true);
      }

      if (key === 'w') {
        event.preventDefault();
        void closeTerminal();
      }

      if (key === 'k') {
        event.preventDefault();
        setIsAiAssistantOpen((prev) => !prev);
      }

      if (key === ',') {
        event.preventDefault();
        setIsSettingsOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [closeTerminal]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    void listen<SshDiagnosticLogEvent>('ssh-diagnostic', (event) => {
      if (disposed) {
        return;
      }
      const payload = event.payload;
      setSshDiagnosticLogs((prev) => {
        const next = [...prev, payload];
        if (next.length <= 2000) {
          return next;
        }
        return next.slice(next.length - 2000);
      });
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void getAppVersion()
      .then((version) => checkForUpdate(version))
      .then((result) => {
        if (cancelled || !result.shouldUpdate) {
          return;
        }
        const latestVersion = result.manifest?.version ?? '新版本';
        const description =
          result.channel === 'tauri'
            ? '可在设置中心点击“检查并更新到最新版本”。'
            : '可在“关于轨连终端”中打开下载页面获取最新版。';
        toast.info(`发现新版本 ${latestVersion}`, { description });
      })
      .catch(() => {
        // Ignore background update check errors.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isNewTabModalOpen) {
      return;
    }
    if (hosts.length === 0) {
      setSelectedTabHostId('');
      return;
    }

    if (selectedTabHostId && hosts.some((host) => buildHostKey(host) === selectedTabHostId)) {
      return;
    }

    const firstHost = hosts[0];
    setSelectedTabHostId(firstHost ? buildHostKey(firstHost) : '');
  }, [hosts, isNewTabModalOpen, selectedTabHostId]);

  useEffect(() => {
    const previous = previousSessionCountRef.current;
    if (previous <= 1 && activeSessions.length > 1) {
      setIsSftpCollapsed(true);
      toast.info('已进入多会话模式，SFTP 面板已自动收起。');
    } else if (activeSessions.length <= 1) {
      setIsSftpCollapsed(false);
    }
    previousSessionCountRef.current = activeSessions.length;
  }, [activeSessions.length]);

  useEffect(() => {
    if (appView !== 'dashboard' || !autoLockEnabled) {
      return;
    }

    const lockAfterMs = 5 * 60 * 1000;
    let hiddenTimer: number | null = null;
    let didLock = false;
    let lastActivityAt = Date.now();

    const triggerAutoLock = (description: string): void => {
      if (didLock) {
        return;
      }
      didLock = true;
      void lockVault().then(() => {
        toast.warning('金库已自动锁定', {
          description
        });
      });
    };

    const markActivity = (): void => {
      lastActivityAt = Date.now();
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        if (hiddenTimer !== null) {
          window.clearTimeout(hiddenTimer);
        }
        hiddenTimer = window.setTimeout(() => {
          triggerAutoLock('应用已隐藏超过 5 分钟。');
        }, lockAfterMs);
      } else {
        if (hiddenTimer !== null) {
          window.clearTimeout(hiddenTimer);
          hiddenTimer = null;
        }
        markActivity();
      }
    };

    const idleCheckTimer = window.setInterval(() => {
      if (Date.now() - lastActivityAt >= lockAfterMs) {
        triggerAutoLock('检测到闲置超过 5 分钟。');
      }
    }, 15000);

    const activityEvents: ReadonlyArray<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'focus'
    ];

    for (const eventName of activityEvents) {
      window.addEventListener(eventName, markActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (hiddenTimer !== null) {
        window.clearTimeout(hiddenTimer);
      }
      window.clearInterval(idleCheckTimer);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, markActivity);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [appView, autoLockEnabled, lockVault]);

  const handleQuickUpdate = async (): Promise<void> => {
    if (isQuickUpdating) {
      return;
    }

    setIsQuickUpdating(true);
    try {
      const version = await getAppVersion();
      const result = await checkForUpdate(version);
      if (!result.shouldUpdate) {
        toast.success('当前已是最新版本');
        return;
      }

      const latestVersion = result.manifest?.version ?? '新版本';
      toast.info(`检测到新版本 ${latestVersion}，正在自动更新...`);
      await installAvailableUpdate(result);

      if (result.channel === 'tauri') {
        toast.success('更新安装完成，正在重启应用...');
        try {
          await relaunch();
        } catch (_error) {
          toast.info('请手动重启应用以完成更新。');
        }
      } else {
        toast.info('当前安装通道不支持静默覆盖，已打开下载页面。');
      }
    } catch (error) {
      const fallback = '更新失败，请稍后重试。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    } finally {
      setIsQuickUpdating(false);
    }
  };

  if (!hasCompletedOnboarding) {
    return (
      <>
        <FirstRunOnboarding />
        <Toaster closeButton expand position="top-right" richColors />
      </>
    );
  }

  if (appView === 'locked') {
    return (
      <>
        <UnlockScreen />
        <Toaster closeButton expand position="top-right" richColors />
      </>
    );
  }

  const sendCommandToTerminal = async (command: string, execute = false): Promise<void> => {
    if (!command.trim()) {
      return;
    }
    if (!activeSessionId) {
      throw new Error('请先建立一个终端会话。');
    }

    try {
      const payload = execute ? `${command}\n` : command;
      await sshWrite(activeSessionId, payload);
      setTerminalError(null);
    } catch (error) {
      const fallback = '写入终端失败，连接可能已断开。';
      const message = error instanceof Error ? error.message : fallback;
      setTerminalError(message || fallback);
      throw new Error(message || fallback);
    }
  };

  const fillCommandIntoTerminal = async (command: string): Promise<void> => {
    await sendCommandToTerminal(command, false);
  };

  const handleSyncPathToSftp = async (): Promise<void> => {
    if (!activeSessionId) {
      toast.error('请先建立终端会话，再执行路径同步。');
      return;
    }
    if (isSyncingPath) {
      return;
    }

    setIsSyncingPath(true);
    try {
      const currentPath = await sshQueryPwd(activeSessionId);
      setSftpSyncRequest({
        sessionId: activeSessionId,
        path: currentPath,
        nonce: Date.now()
      });
      toast.success(`已同步到路径：${currentPath}`);
    } catch (error) {
      const fallback = '路径同步失败，请确认终端仍在线。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    } finally {
      setIsSyncingPath(false);
    }
  };

  const tryAutoReconnect = async (closedSession: { hostId: string; title: string }): Promise<void> => {
    const targetHost = hosts.find((host) => buildHostKey(host) === closedSession.hostId);
    if (!targetHost) {
      toast.error('自动重连失败：未找到原始主机配置。');
      return;
    }

    const maxAttempts = 4;
    const baseDelayMs = 1000;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      setReconnectMessage(`正在尝试自动重连...（第 ${attempt}/${maxAttempts} 次）`);
      const success = await openTerminal(targetHost);
      if (success) {
        setReconnectMessage(null);
        toast.success(`已自动重连：${closedSession.title}`);
        return;
      }

      if (attempt < maxAttempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
    }

    setReconnectMessage(null);
    toast.error(`自动重连失败：${closedSession.title}`);
  };

  const handleAskAiForSshFix = async (errorMessage: string, logContext: string[]) => {
    return aiExplainSshError(errorMessage, logContext);
  };

  const handleExportEncryptedBackup = async (): Promise<void> => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const selectedPath = await saveDialog({
      defaultPath: `orbitterm-vault-backup-${yyyy}${mm}${dd}.bin`
    });

    if (!selectedPath || Array.isArray(selectedPath)) {
      return;
    }

    try {
      const result = await exportEncryptedBackup(selectedPath);
      toast.success('加密备份导出成功', {
        description: `路径：${result.path}（${result.bytes} bytes）`
      });
    } catch (error) {
      const fallback = '导出加密备份失败，请检查目标目录权限。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    }
  };

  const handleDeleteHost = async (hostId: string, hostName: string): Promise<void> => {
    const shouldDelete = window.confirm(`确认删除主机「${hostName}」吗？该操作会同步更新本地金库。`);
    if (!shouldDelete) {
      return;
    }

    try {
      await deleteHost(hostId);
    } catch (error) {
      const fallback = '删除主机失败，请稍后重试。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    }
  };

  const handleSaveHostEdit = async (values: HostEditFormValues): Promise<void> => {
    if (!editingHostId) {
      return;
    }

    try {
      await updateHostAndIdentity(editingHostId, {
        basicInfo: {
          name: values.name,
          address: values.address,
          port: values.port,
          description: values.description
        },
        identity: {
          name: values.identityName,
          username: values.identityUsername,
          authConfig:
            values.method === 'password'
              ? {
                  method: 'password',
                  password: values.password?.trim() ?? '',
                  privateKey: '',
                  passphrase: ''
                }
              : {
                  method: 'privateKey',
                  password: '',
                  privateKey: values.privateKey?.trim() ?? '',
                  passphrase: values.passphrase ?? ''
                }
        }
      });
      setEditingHostId(null);
    } catch (error) {
      const fallback = '保存主机编辑失败，请稍后重试。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    }
  };

  const handleOpenHostWizard = (): void => {
    reset();
    setIsHostWizardOpen(true);
  };

  const handleCloseHostWizard = (): void => {
    setIsHostWizardOpen(false);
  };

  const handleConnectFromHostList = async (hostId: string): Promise<void> => {
    const target = hosts.find((host) => buildHostKey(host) === hostId);
    if (!target) {
      toast.error('未找到目标主机，请刷新后重试。');
      return;
    }

    const success = await openTerminal(target);
    if (success) {
      setDashboardSection('terminal');
    }
  };

  const handleConnectFromNewTabModal = async (): Promise<void> => {
    if (!selectedTabHost) {
      toast.error('请选择一台主机后再新建标签。');
      return;
    }

    const success = await openTerminal(selectedTabHost);
    if (success) {
      setDashboardSection('terminal');
      setIsNewTabModalOpen(false);
    }
  };

  return (
    <main className="h-screen w-screen overflow-hidden p-3 sm:p-4">
      <section className="glass-card flex h-full w-full flex-col overflow-hidden rounded-3xl border border-frost-border bg-frost-panel shadow-glass">
        <header className="shrink-0 border-b border-white/55 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">OrbitTerm · 轨连终端</p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-900">Dashboard · 主机金库</h1>
              <p className="mt-1 text-sm text-slate-600">金库已解锁，可管理主机资产并建立多标签会话。</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={toolbarButtonClass}
                onClick={() => {
                  setIsSettingsOpen(true);
                }}
                type="button"
              >
                设置中心 (Cmd/Ctrl+,)
              </button>
              <button
                className={toolbarButtonClass}
                onClick={() => {
                  setIsAboutOpen(true);
                }}
                type="button"
              >
                关于轨连终端
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              className={`${toolbarButtonClass} ${dashboardSection === 'hosts' ? 'border-[#bfd3ef] bg-[#e8f1ff] text-[#1f4e8f]' : ''}`}
              onClick={() => setDashboardSection('hosts')}
              type="button"
            >
              资产管理
            </button>
            <button
              className={`${toolbarButtonClass} ${dashboardSection === 'terminal' ? 'border-[#bfd3ef] bg-[#e8f1ff] text-[#1f4e8f]' : ''}`}
              onClick={() => setDashboardSection('terminal')}
              type="button"
            >
              终端会话
            </button>
            <button
              className={toolbarButtonClass}
              onClick={handleOpenHostWizard}
              type="button"
            >
              新增主机
            </button>
            <button
              className="rounded-lg border border-[#c3d6f8] bg-[#e9f1ff] px-3 py-1.5 text-xs font-medium text-[#204e8f] hover:bg-[#dbe9ff]"
              onClick={() => {
                setIsNewTabModalOpen(true);
              }}
              type="button"
            >
              新建标签 (Cmd/Ctrl+T)
            </button>
            <button
              className={toolbarButtonClass}
              onClick={() => setIsInspectorOpen(true)}
              type="button"
            >
              连接日志
            </button>
            <button
              className="ml-auto rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
              onClick={() => {
                void lockVault();
              }}
              type="button"
            >
              立即锁定
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden px-5 py-4 sm:px-6 sm:py-5">
          {saveError && (
            <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-700">
              {saveError}
            </p>
          )}

          {dashboardSection === 'hosts' && (
            <section className="flex h-full min-h-0 flex-col rounded-2xl border border-white/65 bg-white/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-800">主机资产列表</h2>
                <button
                  className={toolbarButtonClass}
                  onClick={handleOpenHostWizard}
                  type="button"
                >
                  添加主机
                </button>
              </div>

              <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-auto pr-1">
                {hosts.length === 0 && (
                  <p className="rounded-xl border border-dashed border-white/70 bg-white/65 px-4 py-3 text-sm text-slate-600">
                    当前金库中暂无主机，请点击顶部“新增主机”开始配置。
                  </p>
                )}

                {hosts.map((host, index) => {
                  const hostId = buildHostKey(host);
                  const identity = identities.find((item) => item.id === host.identityId);
                  return (
                    <article
                      className="rounded-xl border border-white/70 bg-white/70 px-4 py-3"
                      key={`${host.basicInfo.address}-${host.identityId}-${index}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-[220px] flex-1">
                          <p className="text-sm font-semibold text-slate-800">
                            {host.basicInfo.name || `${host.basicInfo.address}:${host.basicInfo.port}`}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            {(identity?.username ?? 'unknown')}@{host.basicInfo.address}:{host.basicInfo.port}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">身份：{identity?.name ?? '未绑定身份'}</p>
                          {host.basicInfo.description.trim() && (
                            <p className="mt-1 text-[11px] text-slate-500">备注：{host.basicInfo.description}</p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            className={toolbarButtonClass}
                            onClick={() => {
                              setEditingHostId(hostId);
                            }}
                            type="button"
                          >
                            编辑
                          </button>
                          <button
                            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                            onClick={() => {
                              void handleDeleteHost(
                                hostId,
                                host.basicInfo.name || `${host.basicInfo.address}:${host.basicInfo.port}`
                              );
                            }}
                            type="button"
                          >
                            删除
                          </button>
                          <button
                            className="rounded-lg bg-[#0a3a78] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0d4b98] disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={isConnectingTerminal}
                            onClick={() => {
                              void handleConnectFromHostList(hostId);
                            }}
                            type="button"
                          >
                            {isConnectingTerminal ? '连接中...' : '连接'}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {dashboardSection === 'terminal' && (
            <section className="relative flex h-full min-h-0 gap-3 overflow-hidden rounded-2xl border border-[#1f314e] bg-[#04060a] p-3">
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#1a2c47] bg-[#050a12] p-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[#d7e5ff]">轨连终端</h2>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-lg border border-[#39537a] bg-[#0f1726] px-3 py-1.5 text-xs font-medium text-[#d7e5ff] hover:bg-[#13203a]"
                      onClick={() => {
                        setIsNewTabModalOpen(true);
                      }}
                      type="button"
                    >
                      新建标签
                    </button>
                    <button
                      className="rounded-lg border border-[#39537a] bg-[#0f1726] px-3 py-1.5 text-xs font-medium text-[#d7e5ff] hover:bg-[#13203a]"
                      onClick={() => {
                        setIsInspectorOpen(true);
                      }}
                      type="button"
                    >
                      查看连接日志
                    </button>
                    {activeSessionId && (
                      <button
                        className="rounded-lg border border-[#39537a] bg-[#0f1726] px-3 py-1.5 text-xs font-medium text-[#d7e5ff] hover:bg-[#13203a] disabled:cursor-not-allowed disabled:opacity-55"
                        disabled={isSyncingPath}
                        onClick={() => {
                          void handleSyncPathToSftp();
                        }}
                        type="button"
                      >
                        {isSyncingPath ? '同步中...' : '同步路径'}
                      </button>
                    )}
                    {activeSessionId && (
                      <button
                        className="rounded-lg border border-[#39537a] bg-[#0f1726] px-3 py-1.5 text-xs font-medium text-[#d7e5ff] hover:bg-[#13203a]"
                        onClick={() => {
                          void closeTerminal();
                        }}
                        type="button"
                      >
                        关闭当前 (Cmd/Ctrl+W)
                      </button>
                    )}
                    {activeSessions.length > 1 && (
                      <button
                        className="rounded-lg border border-amber-300 bg-amber-200/90 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                        onClick={() => {
                          setIsSftpCollapsed((prev) => !prev);
                        }}
                        type="button"
                      >
                        {isSftpCollapsed ? '展开 SFTP' : '收起 SFTP'}
                      </button>
                    )}
                  </div>
                </div>

                {terminalError && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="text-xs text-rose-400">{terminalError}</p>
                    <button
                      className="rounded border border-rose-300/50 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200 hover:bg-rose-500/20"
                      onClick={() => {
                        setIsInspectorOpen(true);
                      }}
                      type="button"
                    >
                      问问 AI 怎么修
                    </button>
                  </div>
                )}
                {reconnectMessage && <p className="mt-2 text-xs text-amber-300">{reconnectMessage}</p>}

                <div className="mt-3 flex flex-wrap gap-2">
                  {activeSessions.length === 0 ? (
                    <p className="text-xs text-[#8ca2c5]">暂无会话，请点击“新建标签”或在主机列表中连接。</p>
                  ) : (
                    activeSessions.map((session) => (
                      <div
                        className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
                          activeSessionId === session.id
                            ? 'border-[#4f6f9d] bg-[#11203a] text-[#d7e5ff]'
                            : 'border-[#2a3f61] bg-[#0a1220] text-[#8fa5c7]'
                        }`}
                        key={session.id}
                      >
                        <button
                          className="max-w-[180px] truncate px-1 text-left"
                          onClick={() => {
                            setActiveSession(session.id);
                          }}
                          title={session.title}
                          type="button"
                        >
                          {session.title}
                        </button>
                        <button
                          className="rounded px-1 hover:bg-[#1b2d4a]"
                          onClick={() => {
                            void closeSession(session.id);
                          }}
                          title="关闭标签"
                          type="button"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-3 min-h-0 flex-1">
                  {activeSessions.length > 0 ? (
                    <div className="h-full">
                      {activeSessions.map((session) => (
                        <div
                          className={`${activeSessionId === session.id ? 'block' : 'hidden'} h-full`}
                          key={session.id}
                        >
                          <LoyuTerminal
                            blurPx={terminalBlur}
                            borderColor={activeThemePreset.terminalBorder}
                            fontFamily={terminalFontFamily}
                            fontSize={terminalFontSize}
                            isActive={activeSessionId === session.id}
                            onSessionClosed={() => {
                              const closeReason = handleSessionClosed(session.id);
                              if (closeReason === 'manual') {
                                return;
                              }
                              toast.warning(`SSH 会话中断：${session.title}`);
                              void tryAutoReconnect({
                                hostId: session.hostId,
                                title: session.title
                              });
                            }}
                            onTerminalError={(message) => {
                              setTerminalError(message);
                            }}
                            sessionId={session.id}
                            surfaceHex={activeThemePreset.terminalSurfaceHex}
                            surfaceOpacity={terminalOpacity}
                            theme={activeThemePreset.terminalTheme}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-[#2b4264] bg-[#060b13] text-sm text-[#7f94b4]">
                      请选择一台主机并点击“连接”，或使用“新建标签”。
                    </div>
                  )}
                </div>
              </div>

              {!isSftpCollapsed && (
                <div className="h-full w-[380px] shrink-0 overflow-hidden">
                  <SftpManager
                    className="h-full"
                    onSendToTerminal={sendCommandToTerminal}
                    sessionId={activeSessionId}
                    syncRequest={sftpSyncRequest}
                  />
                </div>
              )}
              {activeSessions.length > 1 && isSftpCollapsed && (
                <button
                  className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-xl border border-amber-300 bg-amber-200 px-3 py-2 text-xs font-semibold text-amber-900 shadow-lg hover:bg-amber-100"
                  onClick={() => {
                    setIsSftpCollapsed(false);
                  }}
                  type="button"
                >
                  展开 SFTP
                </button>
              )}
            </section>
          )}
        </div>
      </section>

      {isHostWizardOpen && (
        <div className="fixed inset-0 z-[128] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="flex h-[min(88vh,860px)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/45 bg-[#f1f7ff]/95 shadow-2xl backdrop-blur-2xl">
            <div className="flex items-center justify-between border-b border-white/60 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">新增主机向导</p>
                <p className="mt-1 text-sm text-slate-700">按步骤填写连接信息，保存后自动写入本地加密金库。</p>
              </div>
              <button
                className={toolbarButtonClass}
                onClick={handleCloseHostWizard}
                type="button"
              >
                关闭
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
              <StepIndicator currentStep={currentStep} />

              <div className="mt-4 rounded-2xl border border-white/65 bg-white/60 p-5">
                {currentStep === 1 && <Step1 />}
                {currentStep === 2 && <Step2 />}
                {currentStep === 3 && <Step3 />}
              </div>

              {submittedHost && (
                <div className="mt-4 space-y-3 rounded-2xl border border-emerald-200/70 bg-emerald-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-emerald-900">主机配置已保存</h2>
                    <div className="flex items-center gap-2">
                      <button
                        className="rounded-xl border border-emerald-300 bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-800"
                        onClick={() => {
                          reset();
                        }}
                        type="button"
                      >
                        新建另一台主机
                      </button>
                      <button
                        className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        onClick={() => {
                          setIsHostWizardOpen(false);
                          setDashboardSection('hosts');
                        }}
                        type="button"
                      >
                        完成并关闭
                      </button>
                    </div>
                  </div>
                  <pre className="overflow-auto rounded-xl bg-slate-900/90 p-3 text-xs leading-6 text-slate-100">
                    {JSON.stringify(submittedHost, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isNewTabModalOpen && (
        <div className="fixed inset-0 z-[129] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-white/35 bg-[#0c1627]/92 p-5 text-[#dceaff] shadow-2xl backdrop-blur-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8fb2e6]">新建标签</p>
                <p className="mt-1 text-sm text-[#b8cae6]">选择一台主机，创建新的终端会话标签。</p>
              </div>
              <button
                className="rounded-lg border border-[#39537a] bg-[#0f1726] px-3 py-1.5 text-xs font-medium text-[#d7e5ff] hover:bg-[#13203a]"
                onClick={() => {
                  setIsNewTabModalOpen(false);
                }}
                type="button"
              >
                关闭
              </button>
            </div>

            {hosts.length === 0 ? (
              <div className="mt-4 rounded-xl border border-[#28405f] bg-[#0a1629] p-4 text-sm text-[#a8c0e3]">
                当前没有可连接主机，请先新增主机。
                <div className="mt-3">
                  <button
                    className="rounded-lg border border-[#3f5b82] bg-[#11223a] px-3 py-1.5 text-xs font-medium text-[#e1eeff] hover:bg-[#193152]"
                    onClick={() => {
                      setIsNewTabModalOpen(false);
                      setIsHostWizardOpen(true);
                    }}
                    type="button"
                  >
                    前往新增主机
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-4 max-h-[320px] space-y-2 overflow-auto pr-1">
                  {hosts.map((host, index) => {
                    const hostId = buildHostKey(host);
                    const identity = identities.find((item) => item.id === host.identityId);
                    const isSelected = selectedTabHostId === hostId;
                    return (
                      <button
                        className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                          isSelected
                            ? 'border-[#4d76ab] bg-[#1a3254]'
                            : 'border-[#2a3f5d] bg-[#0d1a2b]/75 hover:bg-[#13243f]'
                        }`}
                        key={`${hostId}-${index}`}
                        onClick={() => {
                          setSelectedTabHostId(hostId);
                        }}
                        type="button"
                      >
                        <p className="text-sm font-medium text-[#e1eeff]">
                          {host.basicInfo.name || `${host.basicInfo.address}:${host.basicInfo.port}`}
                        </p>
                        <p className="mt-1 text-xs text-[#9fb5d7]">
                          {(identity?.username ?? 'unknown')}@{host.basicInfo.address}:{host.basicInfo.port}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    className="rounded-lg border border-[#39537a] bg-[#0f1726] px-3 py-1.5 text-xs font-medium text-[#d7e5ff] hover:bg-[#13203a]"
                    onClick={() => {
                      setIsNewTabModalOpen(false);
                    }}
                    type="button"
                  >
                    取消
                  </button>
                  <button
                    className="rounded-lg border border-[#4d76ab] bg-[#1a3254] px-3 py-1.5 text-xs font-semibold text-[#e2efff] hover:bg-[#24426b] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!selectedTabHost || isConnectingTerminal}
                    onClick={() => {
                      void handleConnectFromNewTabModal();
                    }}
                    type="button"
                  >
                    {isConnectingTerminal ? '连接中...' : '创建并连接'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <LoyuAiAssistant
        onClose={() => {
          setIsAiAssistantOpen(false);
        }}
        onFill={fillCommandIntoTerminal}
        open={isAiAssistantOpen}
        sessionId={activeSessionId}
      />

      <LoyuInspector
        healthReport={healthReport}
        logs={sshDiagnosticLogs}
        onAskAi={handleAskAiForSshFix}
        onClose={() => {
          setIsInspectorOpen(false);
        }}
        onExportBackup={handleExportEncryptedBackup}
        onRefreshHealth={async () => {
          await performHealthCheck(true);
        }}
        open={isInspectorOpen}
        sessionId={activeSessionId}
        terminalError={terminalError}
      />

      <SettingsDrawer
        isQuickUpdating={isQuickUpdating}
        onClose={() => {
          setIsSettingsOpen(false);
        }}
        onOpenAbout={() => {
          setIsAboutOpen(true);
        }}
        onQuickUpdate={handleQuickUpdate}
        open={isSettingsOpen}
      />

      <AboutLoyuModal
        onClose={() => {
          setIsAboutOpen(false);
        }}
        open={isAboutOpen}
      />

      <HostEditDialog
        host={editingHost}
        identity={editingIdentity}
        isSaving={isSavingVault}
        linkedHostCount={editingLinkedHostCount}
        onClose={() => {
          setEditingHostId(null);
        }}
        onSubmit={handleSaveHostEdit}
        open={Boolean(editingHost)}
      />

      <Toaster closeButton expand position="top-right" richColors />
    </main>
  );
}

export default App;
