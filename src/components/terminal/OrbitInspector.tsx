import { useMemo, useState } from 'react';
import type { AiExplainSshErrorResponse } from '../../services/ai';
import type { HealthCheckResponse, SshDiagnosticLogEvent } from '../../services/inspector';
import type { AppLogEntry } from '../../store/useAppLogStore';
import { useI18n } from '../../i18n/useI18n';

interface OrbitInspectorProps {
  open: boolean;
  sessionId: string | null;
  logs: SshDiagnosticLogEvent[];
  appLogs: AppLogEntry[];
  terminalError: string | null;
  healthReport: HealthCheckResponse | null;
  onClose: () => void;
  onAskAi: (errorMessage: string, logContext: string[]) => Promise<AiExplainSshErrorResponse>;
  onExportBackup: () => Promise<void>;
  onImportBackup: () => Promise<void>;
  onRefreshHealth: () => Promise<void>;
  onClearAppLogs: () => void;
}

const MAX_DISPLAY_LOGS = 400;

const formatTimestamp = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return '--';
  }
  return new Date(value * 1000).toLocaleString();
};

const levelBadgeClass = (level: string): string => {
  if (level === 'error') {
    return 'bg-rose-500/20 text-rose-200';
  }
  if (level === 'warn') {
    return 'bg-amber-500/20 text-amber-200';
  }
  return 'bg-cyan-500/20 text-cyan-200';
};

export function OrbitInspector({
  open,
  sessionId,
  logs,
  appLogs,
  terminalError,
  healthReport,
  onClose,
  onAskAi,
  onExportBackup,
  onImportBackup,
  onRefreshHealth,
  onClearAppLogs
}: OrbitInspectorProps): JSX.Element | null {
  const { t, locale } = useI18n();
  const [aiAdvice, setAiAdvice] = useState<AiExplainSshErrorResponse | null>(null);
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState<boolean>(false);
  const [importBackupLoading, setImportBackupLoading] = useState<boolean>(false);

  const visibleLogs = useMemo(() => {
    const scoped = sessionId ? logs.filter((item) => item.sessionId === sessionId) : logs;
    if (scoped.length <= MAX_DISPLAY_LOGS) {
      return scoped;
    }
    return scoped.slice(scoped.length - MAX_DISPLAY_LOGS);
  }, [logs, sessionId]);

  const visibleAppLogs = useMemo(() => {
    if (appLogs.length <= MAX_DISPLAY_LOGS) {
      return appLogs;
    }
    return appLogs.slice(appLogs.length - MAX_DISPLAY_LOGS);
  }, [appLogs]);

  if (!open) {
    return null;
  }

  const handleAskAi = async (): Promise<void> => {
    if (!terminalError) {
      return;
    }

    setAiLoading(true);
    setAiError(null);
    try {
      const contextLines = visibleLogs.slice(-80).map((item) => {
        return `[${item.level}] [${item.stage}] ${item.message}`;
      });
      const response = await onAskAi(terminalError, contextLines);
      setAiAdvice(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('inspector.aiUnavailable');
      setAiError(message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleExportBackup = async (): Promise<void> => {
    setBackupLoading(true);
    try {
      await onExportBackup();
    } finally {
      setBackupLoading(false);
    }
  };

  const handleImportBackup = async (): Promise<void> => {
    setImportBackupLoading(true);
    try {
      await onImportBackup();
    } finally {
      setImportBackupLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[125] flex items-center justify-center bg-[#02050a]/45 p-4 backdrop-blur-sm">
      <aside className="h-[min(86vh,860px)] w-full max-w-5xl overflow-hidden rounded-3xl border border-[#2a4266] bg-[#071121]/95 text-[#d7e5ff] shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-[#1d314f] px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{t('inspector.title')}</p>
            <p className="text-[11px] text-[#8ea4c7]">{t('inspector.subtitle')}</p>
          </div>
          <button
            className="rounded-md px-2 py-1 text-xs text-[#9db2d4] hover:bg-white/10 hover:text-white"
            onClick={onClose}
            type="button"
          >
            {t('inspector.close')}
          </button>
        </div>

        <div className="h-[calc(100%-58px)] space-y-4 overflow-auto p-4">
          <section className="rounded-xl border border-[#274267] bg-[#0a172c] p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8ea4c7]">
                {t('inspector.section.health')}
              </h3>
              <button
                className="rounded-md border border-[#34527a] bg-[#12233d] px-2 py-1 text-[11px] text-[#d7e5ff] hover:bg-[#183258]"
                onClick={() => {
                  void onRefreshHealth();
                }}
                type="button"
              >
                  {t('inspector.recheck')}
                </button>
              </div>
            {healthReport ? (
              <div className="space-y-2">
                {healthReport.items.map((item) => (
                  <article className="rounded-lg border border-[#1f3658] bg-[#0b1b31] p-2" key={item.id}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-[#dbe8ff]">{item.label}</p>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          item.status === 'ok'
                            ? 'bg-emerald-500/20 text-emerald-200'
                            : 'bg-amber-500/20 text-amber-200'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[#b6cae8]">{item.message}</p>
                    {item.suggestion && (
                      <p className="mt-1 text-[11px] text-[#f4d9a8]">建议：{item.suggestion}</p>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#8ea4c7]">{t('inspector.noHealthReport')}</p>
            )}
          </section>

          <section className="rounded-xl border border-[#274267] bg-[#0a172c] p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8ea4c7]">
                {t('inspector.section.ai')}
              </h3>
              <button
                className="rounded-md border border-[#34527a] bg-[#12233d] px-2 py-1 text-[11px] text-[#d7e5ff] hover:bg-[#183258] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!terminalError || aiLoading}
                onClick={() => {
                  void handleAskAi();
                }}
                type="button"
              >
                {aiLoading ? t('inspector.askingAi') : t('inspector.askAi')}
              </button>
            </div>
            {terminalError ? (
              <p className="rounded-md bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-200">
                {t('inspector.currentError', { error: terminalError })}
              </p>
            ) : (
              <p className="text-xs text-[#8ea4c7]">{t('inspector.noSshError')}</p>
            )}
            {aiError && <p className="mt-2 text-[11px] text-rose-300">{aiError}</p>}
            {aiAdvice && (
              <div className="mt-2 space-y-2 rounded-lg border border-[#1f3658] bg-[#0b1b31] p-2">
                <p className="text-[11px] text-[#95abcc]">Provider: {aiAdvice.provider}</p>
                <pre className="whitespace-pre-wrap break-words rounded bg-[#050d1b] p-2 text-[11px] leading-5 text-[#dce8ff]">
                  {aiAdvice.advice}
                </pre>
                <p className="rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
                  {aiAdvice.riskNotice}
                </p>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[#274267] bg-[#0a172c] p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8ea4c7]">
                {t('inspector.section.backup')}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-[#34527a] bg-[#12233d] px-2 py-1 text-[11px] text-[#d7e5ff] hover:bg-[#183258] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={importBackupLoading}
                  onClick={() => {
                    void handleImportBackup();
                  }}
                  type="button"
                >
                  {importBackupLoading ? t('inspector.importing') : t('inspector.importBackup')}
                </button>
                <button
                  className="rounded-md border border-[#34527a] bg-[#12233d] px-2 py-1 text-[11px] text-[#d7e5ff] hover:bg-[#183258] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={backupLoading}
                  onClick={() => {
                    void handleExportBackup();
                  }}
                  type="button"
                >
                  {backupLoading ? t('inspector.exporting') : t('inspector.exportBackup')}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-[#8ea4c7]">
              导入/导出均使用加密后的 vault.bin，恢复时会忽略设备差异并重建本地配置。
            </p>
          </section>

          <section className="rounded-xl border border-[#274267] bg-[#0a172c] p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8ea4c7]">
                {t('inspector.section.connLogs')}
              </h3>
              <span className="text-[11px] text-[#8ea4c7]">{visibleLogs.length} 条</span>
            </div>

            <div className="max-h-[420px] space-y-2 overflow-auto rounded-lg border border-[#1f3658] bg-[#050d1b] p-2">
              {visibleLogs.length === 0 && (
                <p className="text-[11px] text-[#8ea4c7]">{t('inspector.noConnLogs')}</p>
              )}

              {visibleLogs.map((item, index) => (
                <article className="rounded-md border border-[#1a2f4d] bg-[#08162b] p-2" key={`${item.timestamp}-${index}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${levelBadgeClass(item.level)}`}>
                      {item.level}
                    </span>
                    <span className="text-[10px] text-[#90a7ca]">{formatTimestamp(item.timestamp)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#8ea4c7]">{item.stage}</p>
                  <p className="mt-1 break-words text-[11px] text-[#d6e5ff]">{item.message}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-[#274267] bg-[#0a172c] p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8ea4c7]">
                {t('inspector.section.globalLogs')}
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#8ea4c7]">{visibleAppLogs.length} 条</span>
                <button
                  className="rounded-md border border-[#34527a] bg-[#12233d] px-2 py-1 text-[11px] text-[#d7e5ff] hover:bg-[#183258]"
                  onClick={onClearAppLogs}
                  type="button"
                >
                  {t('inspector.clear')}
                </button>
              </div>
            </div>

            <div className="max-h-[320px] space-y-2 overflow-auto rounded-lg border border-[#1f3658] bg-[#050d1b] p-2">
              {visibleAppLogs.length === 0 && (
                <p className="text-[11px] text-[#8ea4c7]">{t('inspector.noGlobalLogs')}</p>
              )}

              {visibleAppLogs.map((item) => (
                <article className="rounded-md border border-[#1a2f4d] bg-[#08162b] p-2" key={item.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${levelBadgeClass(item.level)}`}>
                      {item.level}
                    </span>
                    <span className="text-[10px] text-[#90a7ca]">
                      {new Date(item.timestamp).toLocaleString(locale, { hour12: false })}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#8ea4c7]">{item.scope}</p>
                  <p className="mt-1 break-words text-[11px] text-[#d6e5ff]">{item.message}</p>
                  {item.detail && (
                    <pre className="mt-1 overflow-auto whitespace-pre-wrap break-words rounded bg-[#050d1b] p-2 text-[10px] leading-5 text-[#9fb7d8]">
                      {item.detail}
                    </pre>
                  )}
                </article>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
