import { useEffect, useMemo, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { save as saveDialog } from '@tauri-apps/api/dialog';
import { Toaster, toast } from 'sonner';
import { Step1 } from './components/wizard/Step1';
import { Step2 } from './components/wizard/Step2';
import { Step3 } from './components/wizard/Step3';
import { StepIndicator } from './components/wizard/StepIndicator';
import { UnlockScreen } from './components/UnlockScreen';
import { FirstRunOnboarding } from './components/FirstRunOnboarding';
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
import { resolveThemePreset } from './theme/loyuTheme';
import { buildHostKey } from './utils/hostKey';

interface SftpSyncRequest {
  sessionId: string;
  path: string;
  nonce: number;
}

function App(): JSX.Element {
  const [isAiAssistantOpen, setIsAiAssistantOpen] = useState<boolean>(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isAboutOpen, setIsAboutOpen] = useState<boolean>(false);
  const [isSyncingPath, setIsSyncingPath] = useState<boolean>(false);
  const [sftpSyncRequest, setSftpSyncRequest] = useState<SftpSyncRequest | null>(null);
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
  const openNewTab = useHostStore((state) => state.openNewTab);
  const setActiveSession = useHostStore((state) => state.setActiveSession);
  const closeSession = useHostStore((state) => state.closeSession);
  const handleSessionClosed = useHostStore((state) => state.handleSessionClosed);
  const closeTerminal = useHostStore((state) => state.closeTerminal);
  const setTerminalError = useHostStore((state) => state.setTerminalError);
  const currentStep = useHostStore((state) => state.currentStep);
  const submittedHost = useHostStore((state) => state.submittedHost);
  const saveError = useHostStore((state) => state.saveError);
  const reset = useHostStore((state) => state.reset);
  const lockVault = useHostStore((state) => state.lockVault);
  const terminalFontSize = useUiSettingsStore((state) => state.terminalFontSize);
  const terminalFontFamily = useUiSettingsStore((state) => state.terminalFontFamily);
  const terminalOpacity = useUiSettingsStore((state) => state.terminalOpacity);
  const terminalBlur = useUiSettingsStore((state) => state.terminalBlur);
  const themePresetId = useUiSettingsStore((state) => state.themePresetId);
  const autoLockEnabled = useUiSettingsStore((state) => state.autoLockEnabled);
  const hasCompletedOnboarding = useUiSettingsStore((state) => state.hasCompletedOnboarding);

  const activeThemePreset = useMemo(() => resolveThemePreset(themePresetId), [themePresetId]);

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
    const handler = (event: KeyboardEvent): void => {
      const hasModifier = event.metaKey || event.ctrlKey;
      if (!hasModifier) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 't') {
        event.preventDefault();
        void openNewTab();
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
  }, [openNewTab, closeTerminal]);

  useEffect(() => {
    document.body.style.background = activeThemePreset.bodyBackground;
  }, [activeThemePreset.bodyBackground]);

  useEffect(() => {
    void performHealthCheck(false);
  }, []);

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

  const sendCommandToTerminal = async (
    command: string,
    execute = false
  ): Promise<void> => {
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

  const tryAutoReconnect = async (
    closedSession: { hostId: string; title: string }
  ): Promise<void> => {
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

  const handleAskAiForSshFix = async (
    errorMessage: string,
    logContext: string[]
  ) => {
    return aiExplainSshError(errorMessage, logContext);
  };

  const handleExportEncryptedBackup = async (): Promise<void> => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const selectedPath = await saveDialog({
      defaultPath: `loyu-vault-backup-${yyyy}${mm}${dd}.bin`
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
      <section className="glass-card w-full overflow-hidden rounded-3xl border border-frost-border bg-frost-panel shadow-glass">
        <div className="border-b border-white/55 px-6 py-5 sm:px-8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Loyu Terminal · 罗屿</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900">Dashboard · 主机金库</h1>
              <p className="mt-1 text-sm text-slate-600">金库已解锁，可管理主机并继续新增连接配置。</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-xl border border-white/75 bg-white/65 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white/90"
                onClick={() => {
                  setIsSettingsOpen(true);
                }}
                type="button"
              >
                设置中心 (Cmd/Ctrl+,)
              </button>
              <button
                className="rounded-xl border border-white/75 bg-white/65 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white/90"
                onClick={() => {
                  setIsAboutOpen(true);
                }}
                type="button"
              >
                关于罗屿
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-8 px-6 py-6 sm:px-8">
          <div className="rounded-2xl border border-white/65 bg-white/50 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-800">主机列表</h2>
              <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-slate-600">
                共 {hosts.length} 台
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {hosts.length === 0 && (
                <p className="rounded-xl border border-dashed border-white/70 bg-white/65 px-4 py-3 text-sm text-slate-600">
                  当前金库中暂无主机，请使用下方向导新增。
                </p>
              )}
              {hosts.map((host, index) => (
                <article className="rounded-xl border border-white/70 bg-white/70 px-4 py-3" key={`${host.basicInfo.address}-${host.identityId}-${index}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{host.basicInfo.name}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {(identities.find((identity) => identity.id === host.identityId)?.username ?? 'unknown')}@
                        {host.basicInfo.address}:{host.basicInfo.port}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        身份：{identities.find((identity) => identity.id === host.identityId)?.name ?? '未绑定身份'}
                      </p>
                    </div>
                    <button
                      className="rounded-lg bg-[#0a3a78] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0d4b98]"
                      disabled={isConnectingTerminal}
                      onClick={() => {
                        void openTerminal(host);
                      }}
                      type="button"
                    >
                      {isConnectingTerminal ? '连接中...' : '新建 Tab'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#1f314e] bg-[#04060a] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[#d7e5ff]">罗屿终端</h2>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-[#39537a] bg-[#0f1726] px-3 py-1.5 text-xs font-medium text-[#d7e5ff] hover:bg-[#13203a]"
                  onClick={() => {
                    void openNewTab();
                  }}
                  type="button"
                >
                  新建标签 (Cmd/Ctrl+T)
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
              </div>
            </div>

            {terminalError && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
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
            {reconnectMessage && <p className="mb-2 text-xs text-amber-300">{reconnectMessage}</p>}

            <div className="mb-3 flex flex-wrap gap-2">
              {activeSessions.length === 0 ? (
                <p className="text-xs text-[#8ca2c5]">暂无会话，点击主机“新建 Tab”开始连接。</p>
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

            {activeSessions.length > 0 ? (
              <div className="relative">
                {activeSessions.map((session) => (
                  <div
                    className={activeSessionId === session.id ? 'block' : 'hidden'}
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
                      surfaceHex={activeThemePreset.terminalSurfaceHex}
                      surfaceOpacity={terminalOpacity}
                      sessionId={session.id}
                      theme={activeThemePreset.terminalTheme}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-[460px] items-center justify-center rounded-2xl border border-dashed border-[#2b4264] bg-[#060b13] text-sm text-[#7f94b4]">
                请选择一台主机并点击“新建 Tab”。
              </div>
            )}

            <SftpManager
              onSendToTerminal={sendCommandToTerminal}
              sessionId={activeSessionId}
              syncRequest={sftpSyncRequest}
            />
          </div>

          <StepIndicator currentStep={currentStep} />

          {saveError && (
            <p className="rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-700">
              {saveError}
            </p>
          )}

          <div className="rounded-2xl border border-white/65 bg-white/45 p-5 sm:p-6">
            {currentStep === 1 && <Step1 />}
            {currentStep === 2 && <Step2 />}
            {currentStep === 3 && <Step3 />}
          </div>

          {submittedHost && (
            <div className="space-y-3 rounded-2xl border border-emerald-200/70 bg-emerald-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-emerald-900">主机配置已保存（预览）</h2>
                <button
                  className="rounded-xl border border-emerald-300 bg-white/70 px-3 py-1.5 text-xs font-medium text-emerald-800"
                  onClick={reset}
                  type="button"
                >
                  新建另一台主机
                </button>
              </div>
              <pre className="overflow-auto rounded-xl bg-slate-900/90 p-3 text-xs leading-6 text-slate-100">
                {JSON.stringify(submittedHost, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </section>

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
        onClose={() => {
          setIsSettingsOpen(false);
        }}
        onOpenAbout={() => {
          setIsAboutOpen(true);
        }}
        open={isSettingsOpen}
      />

      <AboutLoyuModal
        onClose={() => {
          setIsAboutOpen(false);
        }}
        open={isAboutOpen}
      />

      <Toaster closeButton expand position="top-right" richColors />
    </main>
  );
}

export default App;
