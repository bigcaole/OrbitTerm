import { useEffect, useRef, useState } from 'react';
import { aiTranslateCommand, type AiTranslateResponse } from '../../services/ai';

interface LoyuAiAssistantProps {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
  onFill: (command: string) => Promise<void>;
}

export function LoyuAiAssistant({
  open,
  sessionId,
  onClose,
  onFill
}: LoyuAiAssistantProps): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState<string>('');
  const [result, setResult] = useState<AiTranslateResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const handleConvert = async (): Promise<void> => {
    if (!text.trim()) {
      setError('请输入你想执行的操作描述。');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await aiTranslateCommand(text.trim());
      setResult(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : '命令生成失败，请稍后重试。';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!result?.command) {
      return;
    }
    try {
      await navigator.clipboard.writeText(result.command);
    } catch (_err) {
      setError('复制失败，请检查系统剪贴板权限。');
    }
  };

  const handleFill = async (): Promise<void> => {
    if (!result?.command) {
      return;
    }
    await onFill(result.command);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-[#02050a]/50 px-4 pt-24 backdrop-blur-md">
      <section className="w-full max-w-2xl rounded-2xl border border-white/20 bg-[#0a1220]/90 p-4 shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[#dce8ff]">罗屿灵思 Loyu AI</p>
          <button
            className="rounded-md px-2 py-1 text-xs text-[#9db2d4] hover:bg-white/10 hover:text-white"
            onClick={onClose}
            type="button"
          >
            Esc 关闭
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#2a4266] bg-[#0c182b] p-2">
          <input
            className="w-full bg-transparent px-2 py-1.5 text-sm text-[#e8f0ff] outline-none placeholder:text-[#7f95b8]"
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleConvert();
              }
            }}
            placeholder="例如：查看占用 80 端口的进程"
            ref={inputRef}
            value={text}
          />
          <button
            className="rounded-lg bg-[#2f6df4] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#417bff]"
            disabled={loading}
            onClick={() => {
              void handleConvert();
            }}
            type="button"
          >
            {loading ? '生成中...' : '生成命令'}
          </button>
        </div>

        <p className="mt-2 text-[11px] text-[#8ea4c7]">快捷键：Cmd/Ctrl + K 可随时呼出</p>

        {error && <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}

        {result && (
          <div className="mt-3 space-y-3 rounded-xl border border-[#2a4266] bg-[#081325] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-[#95abcc]">Provider: {result.provider}</p>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-[#36547f] bg-[#0f1f37] px-3 py-1 text-xs text-[#dce8ff] hover:bg-[#15305a]"
                  onClick={() => {
                    void handleCopy();
                  }}
                  type="button"
                >
                  复制
                </button>
                <button
                  className="rounded-md border border-[#36547f] bg-[#0f1f37] px-3 py-1 text-xs text-[#dce8ff] hover:bg-[#15305a] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!sessionId}
                  onClick={() => {
                    void handleFill();
                  }}
                  type="button"
                >
                  填入终端
                </button>
              </div>
            </div>

            <pre className="overflow-auto rounded-lg bg-[#050c18] px-3 py-2 text-xs text-[#dce8ff]">
              {result.command}
            </pre>

            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {result.riskNotice}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
