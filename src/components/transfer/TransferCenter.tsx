import { useMemo } from 'react';
import { useTransferStore } from '../../store/useTransferStore';

const panelButtonClass =
  'rounded-md border border-[#4f6f9f] bg-[#0f1c30] px-2.5 py-1 text-xs text-[#d5e6ff] hover:bg-[#163153]';

const statusLabelMap = {
  waiting: '等待中',
  running: '进行中',
  completed: '已完成',
  failed: '失败'
} as const;

const formatBytes = (value: number): string => {
  const bytes = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (bytes < 1024) {
    return `${bytes.toFixed(0)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const taskProgress = (transferred: number, total: number): number => {
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (transferred / total) * 100));
};

export function TransferCenter(): JSX.Element {
  const transferQueue = useTransferStore((state) => state.transferQueue);
  const maxConcurrent = useTransferStore((state) => state.maxConcurrent);
  const panelCollapsed = useTransferStore((state) => state.panelCollapsed);
  const setMaxConcurrent = useTransferStore((state) => state.setMaxConcurrent);
  const setPanelCollapsed = useTransferStore((state) => state.setPanelCollapsed);
  const retryTask = useTransferStore((state) => state.retryTask);
  const removeTask = useTransferStore((state) => state.removeTask);
  const clearFinished = useTransferStore((state) => state.clearFinished);

  const summary = useMemo(() => {
    const running = transferQueue.filter((item) => item.status === 'running').length;
    const waiting = transferQueue.filter((item) => item.status === 'waiting').length;
    const failed = transferQueue.filter((item) => item.status === 'failed').length;
    return { running, waiting, failed };
  }, [transferQueue]);

  if (panelCollapsed) {
    return (
      <div className="fixed bottom-3 right-3 z-[120]">
        <button
          className="rounded-lg border border-[#4b6d9e] bg-[#0d1a2f]/95 px-3 py-1.5 text-xs font-semibold text-[#d8e8ff] shadow-lg backdrop-blur hover:bg-[#163055]"
          onClick={() => {
            setPanelCollapsed(false);
          }}
          type="button"
        >
          传输中心 ({summary.running}/{summary.waiting})
        </button>
      </div>
    );
  }

  return (
    <section className="fixed bottom-3 right-3 z-[120] flex h-[300px] w-[420px] flex-col overflow-hidden rounded-2xl border border-[#36537d] bg-[#091426]/95 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-[#29425f] px-3 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8faed8]">Transfer Center</p>
          <p className="text-[11px] text-[#bed4f3]">
            进行中 {summary.running} · 等待 {summary.waiting} · 失败 {summary.failed}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-[#bad2f3]">
            并发
            <select
              className="rounded border border-[#4a6994] bg-[#0d1d32] px-1 py-0.5 text-[11px] text-[#e3efff] outline-none"
              onChange={(event) => {
                setMaxConcurrent(Number(event.target.value));
              }}
              value={maxConcurrent}
            >
              {[1, 2, 3, 4, 5, 6].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button
            className={panelButtonClass}
            onClick={() => {
              clearFinished();
            }}
            type="button"
          >
            清理已完成
          </button>
          <button
            className={panelButtonClass}
            onClick={() => {
              setPanelCollapsed(true);
            }}
            type="button"
          >
            收起
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {transferQueue.length === 0 && (
          <div className="rounded-lg border border-dashed border-[#355579] bg-[#0c1b31] px-3 py-4 text-xs text-[#9fb9dd]">
            暂无传输任务。可在 SFTP 中上传或下载文件后自动进入队列。
          </div>
        )}

        {transferQueue.map((task) => {
          const progress = taskProgress(task.transferredBytes, task.totalBytes);
          return (
            <article className="rounded-lg border border-[#2f4a70] bg-[#0c1a2e] p-2.5" key={task.id}>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-semibold text-[#deebff]">
                  {task.direction === 'upload' ? '上传' : '下载'} · {task.fileName}
                </p>
                <span className="text-[11px] text-[#9fb8da]">{statusLabelMap[task.status]}</span>
              </div>

              <div className="mt-1 h-1.5 overflow-hidden rounded bg-[#162740]">
                <div
                  className={`h-full rounded ${
                    task.status === 'failed'
                      ? 'bg-rose-500'
                      : task.status === 'completed'
                        ? 'bg-emerald-500'
                        : 'bg-[#4c9fff]'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="mt-1 flex items-center justify-between text-[11px] text-[#9db7da]">
                <span>
                  {formatBytes(task.transferredBytes)}
                  {task.totalBytes > 0 ? ` / ${formatBytes(task.totalBytes)}` : ' / --'}
                </span>
                <span>{task.totalBytes > 0 ? `${progress.toFixed(1)}%` : '--'}</span>
              </div>

              {task.error && <p className="mt-1 text-[11px] text-rose-300">{task.error}</p>}

              <div className="mt-1.5 flex items-center gap-2">
                {task.status === 'failed' && (
                  <button
                    className="rounded border border-[#5b7fb2] bg-[#163155] px-2 py-0.5 text-[11px] text-[#e2efff] hover:bg-[#1f4475]"
                    onClick={() => {
                      retryTask(task.id);
                    }}
                    type="button"
                  >
                    重试（断点续传）
                  </button>
                )}
                {(task.status === 'completed' || task.status === 'failed') && (
                  <button
                    className="rounded border border-[#49658d] bg-[#11243f] px-2 py-0.5 text-[11px] text-[#d1e1f9] hover:bg-[#19345a]"
                    onClick={() => {
                      removeTask(task.id);
                    }}
                    type="button"
                  >
                    移除
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
