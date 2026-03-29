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
  onRefreshHealth: () => Promise<void>;
  onClearAppLogs: () => void;
}

const MAX_DISPLAY_LOGS = 400;
const VIRTUAL_LIST_THRESHOLD = 120;
const VIRTUAL_ROW_HEIGHT = 92;
const VIRTUAL_OVERSCAN = 8;

interface VirtualWindow {
  start: number;
  end: number;
  topSpacer: number;
  bottomSpacer: number;
}

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

const buildVirtualWindow = (
  total: number,
  scrollTop: number,
  viewportHeight: number
): VirtualWindow => {
  if (total <= 0) {
    return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 };
  }
  const rawStart = Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT);
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT));
  const start = Math.max(0, rawStart - VIRTUAL_OVERSCAN);
  const end = Math.min(total, rawStart + visibleCount + VIRTUAL_OVERSCAN);
  const topSpacer = start * VIRTUAL_ROW_HEIGHT;
  const bottomSpacer = Math.max(0, (total - end) * VIRTUAL_ROW_HEIGHT);
  return { start, end, topSpacer, bottomSpacer };
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
  onRefreshHealth,
  onClearAppLogs
}: OrbitInspectorProps): JSX.Element | null {
  const { t, locale } = useI18n();
  const [aiAdvice, setAiAdvice] = useState<AiExplainSshErrorResponse | null>(null);
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [connScrollTop, setConnScrollTop] = useState<number>(0);
  const [globalScrollTop, setGlobalScrollTop] = useState<number>(0);

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

  const connVirtualEnabled = visibleLogs.length > VIRTUAL_LIST_THRESHOLD;
  const globalVirtualEnabled = visibleAppLogs.length > VIRTUAL_LIST_THRESHOLD;

  const connVirtualWindow = useMemo(() => {
    if (!connVirtualEnabled) {
      return buildVirtualWindow(visibleLogs.length, 0, 420);
    }
    return buildVirtualWindow(visibleLogs.length, connScrollTop, 420);
  }, [connScrollTop, connVirtualEnabled, visibleLogs.length]);

  const globalVirtualWindow = useMemo(() => {
    if (!globalVirtualEnabled) {
      return buildVirtualWindow(visibleAppLogs.length, 0, 320);
    }
    return buildVirtualWindow(visibleAppLogs.length, globalScrollTop, 320);
  }, [globalScrollTop, globalVirtualEnabled, visibleAppLogs.length]);

  const renderConnLogs = connVirtualEnabled
    ? visibleLogs.slice(connVirtualWindow.start, connVirtualWindow.end)
    : visibleLogs;
  const renderGlobalLogs = globalVirtualEnabled
    ? visibleAppLogs.slice(globalVirtualWindow.start, globalVirtualWindow.end)
    : visibleAppLogs;

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
                {t('inspector.section.connLogs')}
              </h3>
              <span className="text-[11px] text-[#8ea4c7]">{visibleLogs.length} 条</span>
            </div>

            <div
              className="max-h-[420px] space-y-2 overflow-auto rounded-lg border border-[#1f3658] bg-[#050d1b] p-2"
              onScroll={(event) => {
                if (!connVirtualEnabled) {
                  return;
                }
                setConnScrollTop(event.currentTarget.scrollTop);
              }}
            >
              {visibleLogs.length === 0 && (
                <p className="text-[11px] text-[#8ea4c7]">{t('inspector.noConnLogs')}</p>
              )}

              {connVirtualEnabled && connVirtualWindow.topSpacer > 0 ? (
                <div style={{ height: `${connVirtualWindow.topSpacer}px` }} />
              ) : null}

              {renderConnLogs.map((item, index) => {
                const absoluteIndex = connVirtualEnabled ? connVirtualWindow.start + index : index;
                return (
                <article
                  className="rounded-md border border-[#1a2f4d] bg-[#08162b] p-2"
                  key={`${item.timestamp}-${absoluteIndex}`}
                  style={connVirtualEnabled ? { height: `${VIRTUAL_ROW_HEIGHT - 8}px`, overflow: 'hidden' } : undefined}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${levelBadgeClass(item.level)}`}>
                      {item.level}
                    </span>
                    <span className="text-[10px] text-[#90a7ca]">{formatTimestamp(item.timestamp)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#8ea4c7]">{item.stage}</p>
                  <p className="mt-1 break-words text-[11px] text-[#d6e5ff]">{item.message}</p>
                </article>
                );
              })}

              {connVirtualEnabled && connVirtualWindow.bottomSpacer > 0 ? (
                <div style={{ height: `${connVirtualWindow.bottomSpacer}px` }} />
              ) : null}
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

            <div
              className="max-h-[320px] space-y-2 overflow-auto rounded-lg border border-[#1f3658] bg-[#050d1b] p-2"
              onScroll={(event) => {
                if (!globalVirtualEnabled) {
                  return;
                }
                setGlobalScrollTop(event.currentTarget.scrollTop);
              }}
            >
              {visibleAppLogs.length === 0 && (
                <p className="text-[11px] text-[#8ea4c7]">{t('inspector.noGlobalLogs')}</p>
              )}

              {globalVirtualEnabled && globalVirtualWindow.topSpacer > 0 ? (
                <div style={{ height: `${globalVirtualWindow.topSpacer}px` }} />
              ) : null}

              {renderGlobalLogs.map((item) => (
                <article
                  className="rounded-md border border-[#1a2f4d] bg-[#08162b] p-2"
                  key={item.id}
                  style={globalVirtualEnabled ? { height: `${VIRTUAL_ROW_HEIGHT - 8}px`, overflow: 'hidden' } : undefined}
                >
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

              {globalVirtualEnabled && globalVirtualWindow.bottomSpacer > 0 ? (
                <div style={{ height: `${globalVirtualWindow.bottomSpacer}px` }} />
              ) : null}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
