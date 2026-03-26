import { useMemo, useState } from 'react';
import type { AiExplainSshErrorResponse } from '../../services/ai';
import type { HealthCheckResponse, SshDiagnosticLogEvent } from '../../services/inspector';

interface LoyuInspectorProps {
  open: boolean;
  sessionId: string | null;
  logs: SshDiagnosticLogEvent[];
  terminalError: string | null;
  healthReport: HealthCheckResponse | null;
  onClose: () => void;
  onAskAi: (errorMessage: string, logContext: string[]) => Promise<AiExplainSshErrorResponse>;
  onExportBackup: () => Promise<void>;
  onRefreshHealth: () => Promise<void>;
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

export function LoyuInspector({
  open,
  sessionId,
  logs,
  terminalError,
  healthReport,
  onClose,
  onAskAi,
  onExportBackup,
  onRefreshHealth
}: LoyuInspectorProps): JSX.Element | null {
  const [aiAdvice, setAiAdvice] = useState<AiExplainSshErrorResponse | null>(null);
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState<boolean>(false);

  const visibleLogs = useMemo(() => {
    const scoped = sessionId ? logs.filter((item) => item.sessionId === sessionId) : logs;
    if (scoped.length <= MAX_DISPLAY_LOGS) {
      return scoped;
    }
    return scoped.slice(scoped.length - MAX_DISPLAY_LOGS);
  }, [logs, sessionId]);

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
      const message = error instanceof Error ? error.message : 'AI 诊断暂不可用，请稍后重试。';
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

  return (
    <div className="fixed inset-0 z-[95] flex justify-end bg-[#02050a]/35 backdrop-blur-sm">
      <aside className="h-full w-full max-w-[520px] overflow-hidden border-l border-[#2a4266] bg-[#071121]/95 text-[#d7e5ff] shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-[#1d314f] px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Loyu Inspector</p>
            <p className="text-[11px] text-[#8ea4c7]">开发者诊断工具</p>
          </div>
          <button
            className="rounded-md px-2 py-1 text-xs text-[#9db2d4] hover:bg-white/10 hover:text-white"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </div>

        <div className="h-[calc(100%-58px)] space-y-4 overflow-auto p-4">
          <section className="rounded-xl border border-[#274267] bg-[#0a172c] p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8ea4c7]">健康检查</h3>
              <button
                className="rounded-md border border-[#34527a] bg-[#12233d] px-2 py-1 text-[11px] text-[#d7e5ff] hover:bg-[#183258]"
                onClick={() => {
                  void onRefreshHealth();
                }}
                type="button"
              >
                重新检查
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
              <p className="text-xs text-[#8ea4c7]">尚未获取健康检查结果。</p>
            )}
          </section>

          <section className="rounded-xl border border-[#274267] bg-[#0a172c] p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8ea4c7]">AI 故障解释</h3>
              <button
                className="rounded-md border border-[#34527a] bg-[#12233d] px-2 py-1 text-[11px] text-[#d7e5ff] hover:bg-[#183258] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!terminalError || aiLoading}
                onClick={() => {
                  void handleAskAi();
                }}
                type="button"
              >
                {aiLoading ? '分析中...' : '问问 AI 怎么修'}
              </button>
            </div>
            {terminalError ? (
              <p className="rounded-md bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-200">
                当前错误：{terminalError}
              </p>
            ) : (
              <p className="text-xs text-[#8ea4c7]">当前无 SSH 错误。</p>
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
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8ea4c7]">配置备份</h3>
              <button
                className="rounded-md border border-[#34527a] bg-[#12233d] px-2 py-1 text-[11px] text-[#d7e5ff] hover:bg-[#183258] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={backupLoading}
                onClick={() => {
                  void handleExportBackup();
                }}
                type="button"
              >
                {backupLoading ? '导出中...' : '导出加密备份文件'}
              </button>
            </div>
            <p className="text-[11px] text-[#8ea4c7]">
              导出的是加密后的 vault.bin，不包含明文主机数据。
            </p>
          </section>

          <section className="rounded-xl border border-[#274267] bg-[#0a172c] p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8ea4c7]">连接日志</h3>
              <span className="text-[11px] text-[#8ea4c7]">{visibleLogs.length} 条</span>
            </div>

            <div className="max-h-[380px] space-y-2 overflow-auto rounded-lg border border-[#1f3658] bg-[#050d1b] p-2">
              {visibleLogs.length === 0 && (
                <p className="text-[11px] text-[#8ea4c7]">暂无日志。建立 SSH 连接后会实时显示握手与认证信息。</p>
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
        </div>
      </aside>
    </div>
  );
}
