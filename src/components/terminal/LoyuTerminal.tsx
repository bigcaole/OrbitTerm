import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Terminal, type ITheme } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebglAddon } from 'xterm-addon-webgl';
import { Unicode11Addon } from 'xterm-addon-unicode11';
import 'xterm/css/xterm.css';
import { sshResize, sshWrite } from '../../services/ssh';
import { toRgba } from '../../theme/loyuTheme';

interface LoyuTerminalProps {
  sessionId: string;
  isActive: boolean;
  onSessionClosed: () => void;
  onTerminalError: (message: string) => void;
  fontFamily: string;
  fontSize: number;
  theme: ITheme;
  surfaceHex: string;
  surfaceOpacity: number;
  blurPx: number;
  borderColor: string;
}

interface SshOutputEvent {
  sessionId: string;
  data: string;
}

interface SshErrorEvent {
  sessionId?: string;
  message: string;
}

interface SshClosedEvent {
  sessionId: string;
}

const OUTPUT_FLUSH_CHARS_PER_FRAME = 64 * 1024;
const OUTPUT_BUFFER_LIMIT_CHARS = 2 * 1024 * 1024;

export function LoyuTerminal({
  sessionId,
  isActive,
  onSessionClosed,
  onTerminalError,
  fontFamily,
  fontSize,
  theme,
  surfaceHex,
  surfaceOpacity,
  blurPx,
  borderColor
}: LoyuTerminalProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const resizeSyncRef = useRef<(() => void) | null>(null);

  const outputQueueRef = useRef<string[]>([]);
  const queuedCharsRef = useRef<number>(0);
  const droppedCharsRef = useRef<number>(0);
  const dropNoticeShownRef = useRef<boolean>(false);
  const flushRafRef = useRef<number>(0);
  const disposedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    disposedRef.current = false;
    outputQueueRef.current = [];
    queuedCharsRef.current = 0;
    droppedCharsRef.current = 0;
    dropNoticeShownRef.current = false;
    flushRafRef.current = 0;

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily,
      fontSize,
      lineHeight: 1.2,
      theme
    });
    terminalRef.current = terminal;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    const unicode11Addon = new Unicode11Addon();
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = '11';

    terminal.loadAddon(fitAddon);

    try {
      const webglAddon = new WebglAddon();
      webglAddonRef.current = webglAddon;
      terminal.loadAddon(webglAddon);
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
    } catch (_error) {
      terminal.writeln('\\x1b[33m[提示] WebGL 加速不可用，已回退到 Canvas 渲染。\\x1b[0m');
    }

    terminal.open(hostRef.current);
    fitAddon.fit();

    const pushResize = (): void => {
      const cols = terminal.cols;
      const rows = terminal.rows;
      if (cols > 0 && rows > 0) {
        void sshResize(sessionId, cols, rows).catch(() => {
          onTerminalError('终端窗口同步失败，请检查网络连接。');
        });
      }
    };
    resizeSyncRef.current = pushResize;

    pushResize();

    const scheduleFlush = (): void => {
      if (disposedRef.current || flushRafRef.current !== 0) {
        return;
      }

      flushRafRef.current = window.requestAnimationFrame(() => {
        flushRafRef.current = 0;

        if (disposedRef.current) {
          return;
        }

        const activeTerminal = terminalRef.current;
        if (!activeTerminal) {
          return;
        }

        if (!dropNoticeShownRef.current && droppedCharsRef.current > 0) {
          dropNoticeShownRef.current = true;
          activeTerminal.writeln(
            '\\r\\n\\x1b[33m[提示] 输出过载：为保持界面流畅，已丢弃部分历史输出。\\x1b[0m'
          );
        }

        let remainingBudget = OUTPUT_FLUSH_CHARS_PER_FRAME;
        let payload = '';

        while (remainingBudget > 0 && outputQueueRef.current.length > 0) {
          const head = outputQueueRef.current[0];
          if (!head) {
            outputQueueRef.current.shift();
            continue;
          }

          if (head.length <= remainingBudget) {
            payload += head;
            remainingBudget -= head.length;
            queuedCharsRef.current = Math.max(0, queuedCharsRef.current - head.length);
            outputQueueRef.current.shift();
          } else {
            payload += head.slice(0, remainingBudget);
            outputQueueRef.current[0] = head.slice(remainingBudget);
            queuedCharsRef.current = Math.max(0, queuedCharsRef.current - remainingBudget);
            remainingBudget = 0;
          }
        }

        if (!payload) {
          if (outputQueueRef.current.length > 0) {
            scheduleFlush();
          }
          return;
        }

        activeTerminal.write(payload, () => {
          if (disposedRef.current) {
            return;
          }
          if (outputQueueRef.current.length > 0) {
            scheduleFlush();
          }
        });
      });
    };

    const enqueueOutput = (chunk: string): void => {
      if (disposedRef.current || !chunk) {
        return;
      }

      outputQueueRef.current.push(chunk);
      queuedCharsRef.current += chunk.length;

      while (queuedCharsRef.current > OUTPUT_BUFFER_LIMIT_CHARS && outputQueueRef.current.length > 0) {
        const dropped = outputQueueRef.current.shift();
        if (!dropped) {
          break;
        }
        queuedCharsRef.current = Math.max(0, queuedCharsRef.current - dropped.length);
        droppedCharsRef.current += dropped.length;
      }

      scheduleFlush();
    };

    const dataDisposable = terminal.onData((data) => {
      void sshWrite(sessionId, data).catch(() => {
        onTerminalError('发送输入失败，连接可能已断开。');
      });
    });

    const unlisteners: UnlistenFn[] = [];
    let disposed = false;

    void listen<SshOutputEvent>('ssh-output', (event) => {
      if (event.payload.sessionId !== sessionId) {
        return;
      }

      enqueueOutput(event.payload.data);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    });

    void listen<SshErrorEvent>('ssh-error', (event) => {
      const eventSessionId = event.payload.sessionId;
      if (eventSessionId && eventSessionId !== sessionId) {
        return;
      }
      onTerminalError(event.payload.message);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    });

    void listen<SshClosedEvent>('ssh-closed', (event) => {
      if (event.payload.sessionId !== sessionId) {
        return;
      }
      onSessionClosed();
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    });

    let rafId = 0;
    const observer = new ResizeObserver(() => {
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(() => {
        fitAddon.fit();
        pushResize();
      });
    });

    observer.observe(hostRef.current);

    return () => {
      disposed = true;
      disposedRef.current = true;

      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
      if (flushRafRef.current !== 0) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = 0;
      }

      observer.disconnect();
      dataDisposable.dispose();
      for (const unlisten of unlisteners) {
        unlisten();
      }

      outputQueueRef.current = [];
      queuedCharsRef.current = 0;
      droppedCharsRef.current = 0;
      dropNoticeShownRef.current = false;

      if (webglAddonRef.current) {
        webglAddonRef.current.dispose();
        webglAddonRef.current = null;
      }

      fitAddonRef.current = null;
      resizeSyncRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [sessionId, onSessionClosed, onTerminalError]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.fontFamily = fontFamily;
    terminal.options.fontSize = fontSize;
    terminal.options.theme = theme;
    fitAddonRef.current?.fit();
    resizeSyncRef.current?.();
  }, [fontFamily, fontSize, theme]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      resizeSyncRef.current?.();
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isActive]);

  return (
    <div
      className="h-[460px] w-full rounded-2xl border p-2"
      ref={hostRef}
      style={{
        borderColor,
        background: toRgba(surfaceHex, surfaceOpacity / 100),
        backdropFilter: `blur(${blurPx}px)`,
        WebkitBackdropFilter: `blur(${blurPx}px)`
      }}
    />
  );
}
