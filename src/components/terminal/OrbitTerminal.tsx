import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent
} from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Terminal, type ITheme } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebglAddon } from 'xterm-addon-webgl';
import { Unicode11Addon } from 'xterm-addon-unicode11';
import 'xterm/css/xterm.css';
import { sshResize } from '../../services/ssh';
import { toRgba } from '../../theme/orbitTheme';

export type SplitDirection = 'horizontal' | 'vertical';

export interface TerminalSplitPane {
  id: string;
  sessionId: string;
  hostId: string;
  title: string;
}

export type TerminalLayoutNode =
  | {
      type: 'pane';
      pane: TerminalSplitPane;
    }
  | {
      type: 'split';
      id: string;
      direction: SplitDirection;
      first: TerminalLayoutNode;
      second: TerminalLayoutNode;
      sizes?: [number, number];
    };

interface OrbitTerminalProps {
  layout: TerminalLayoutNode;
  activePaneId: string;
  isTabActive: boolean;
  onActivePaneChange: (paneId: string) => void;
  onPaneContextMenu: (event: ReactMouseEvent<HTMLElement>, paneId: string) => void;
  onPaneInput: (sessionId: string, data: string) => void;
  onPaneSessionClosed: (paneId: string, sessionId: string) => void;
  onTerminalError: (message: string) => void;
  fontFamily: string;
  fontSize: number;
  theme: ITheme;
  surfaceHex: string;
  surfaceOpacity: number;
  blurPx: number;
  borderColor: string;
}

interface TerminalInstanceProps {
  pane: TerminalSplitPane;
  isFocused: boolean;
  fontFamily: string;
  fontSize: number;
  theme: ITheme;
  surfaceHex: string;
  surfaceOpacity: number;
  blurPx: number;
  borderColor: string;
  onFocusPane: (paneId: string) => void;
  onPaneContextMenu: (event: ReactMouseEvent<HTMLElement>, paneId: string) => void;
  onPaneInput: (sessionId: string, data: string) => void;
  onPaneSessionClosed: (paneId: string, sessionId: string) => void;
  onTerminalError: (message: string) => void;
  onRegisterApi: (paneId: string, api: TerminalInstanceApi | null) => void;
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

interface TerminalInstanceApi {
  fit: () => void;
  focus: () => void;
}

const OUTPUT_FLUSH_CHARS_PER_FRAME = 64 * 1024;
const OUTPUT_BUFFER_LIMIT_CHARS = 2 * 1024 * 1024;

const isWindowsPlatform = (): boolean => {
  return navigator.userAgent.toLowerCase().includes('windows');
};

const collectPaneIds = (node: TerminalLayoutNode): string[] => {
  if (node.type === 'pane') {
    return [node.pane.id];
  }
  return [...collectPaneIds(node.first), ...collectPaneIds(node.second)];
};

function TerminalInstance({
  pane,
  isFocused,
  fontFamily,
  fontSize,
  theme,
  surfaceHex,
  surfaceOpacity,
  blurPx,
  borderColor,
  onFocusPane,
  onPaneContextMenu,
  onPaneInput,
  onPaneSessionClosed,
  onTerminalError,
  onRegisterApi
}: TerminalInstanceProps): JSX.Element {
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

  const onPaneSessionClosedRef = useRef(onPaneSessionClosed);
  const onTerminalErrorRef = useRef(onTerminalError);
  const onPaneInputRef = useRef(onPaneInput);

  useEffect(() => {
    onPaneSessionClosedRef.current = onPaneSessionClosed;
  }, [onPaneSessionClosed]);

  useEffect(() => {
    onTerminalErrorRef.current = onTerminalError;
  }, [onTerminalError]);

  useEffect(() => {
    onPaneInputRef.current = onPaneInput;
  }, [onPaneInput]);

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
      allowProposedApi: true,
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      customGlyphs: true,
      drawBoldTextInBrightColors: true,
      fontFamily,
      fontSize,
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: 1.24,
      theme
    });
    terminalRef.current = terminal;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    const unicode11Addon = new Unicode11Addon();
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = '11';

    terminal.loadAddon(fitAddon);

    if (!isWindowsPlatform()) {
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
    } else {
      terminal.writeln('[提示] Windows 默认禁用 WebGL 渲染以提升稳定性。');
    }

    terminal.open(hostRef.current);
    fitAddon.fit();

    const pushResize = (): void => {
      const cols = terminal.cols;
      const rows = terminal.rows;
      if (cols > 0 && rows > 0) {
        void sshResize(pane.sessionId, cols, rows).catch(() => {
          onTerminalErrorRef.current('终端窗口同步失败，请检查网络连接。');
        });
      }
    };
    resizeSyncRef.current = pushResize;

    const instanceApi: TerminalInstanceApi = {
      fit: () => {
        fitAddon.fit();
        pushResize();
      },
      focus: () => {
        terminal.focus();
      }
    };
    onRegisterApi(pane.id, instanceApi);

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
      onPaneInputRef.current(pane.sessionId, data);
    });

    const unlisteners: UnlistenFn[] = [];
    let disposed = false;

    void listen<SshOutputEvent>('ssh-output', (event) => {
      if (event.payload.sessionId !== pane.sessionId) {
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
      if (eventSessionId && eventSessionId !== pane.sessionId) {
        return;
      }
      onTerminalErrorRef.current(event.payload.message);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    });

    void listen<SshClosedEvent>('ssh-closed', (event) => {
      if (event.payload.sessionId !== pane.sessionId) {
        return;
      }
      onPaneSessionClosedRef.current(pane.id, pane.sessionId);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    });

    let rafId = 0;
    const handleResize = (): void => {
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(() => {
        fitAddon.fit();
        pushResize();
      });
    };

    const resizeObserverSupported =
      typeof window !== 'undefined' && typeof window.ResizeObserver !== 'undefined';
    const observer = resizeObserverSupported ? new ResizeObserver(handleResize) : null;
    if (observer) {
      observer.observe(hostRef.current);
    } else {
      window.addEventListener('resize', handleResize);
    }

    return () => {
      disposed = true;
      disposedRef.current = true;

      onRegisterApi(pane.id, null);

      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
      if (flushRafRef.current !== 0) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = 0;
      }

      if (observer) {
        observer.disconnect();
      } else {
        window.removeEventListener('resize', handleResize);
      }
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
  }, [onRegisterApi, pane.id, pane.sessionId]);

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
    if (!isFocused) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      resizeSyncRef.current?.();
      terminalRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isFocused]);

  return (
    <div
      className={`flex h-full min-h-0 flex-col rounded-xl border p-2 ${
        isFocused ? 'border-[#4f78af] bg-[#07111f]' : 'border-[#243954] bg-[#050d18]'
      }`}
      onContextMenu={(event) => {
        onPaneContextMenu(event, pane.id);
      }}
      onMouseDown={() => {
        onFocusPane(pane.id);
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          className={`min-w-0 max-w-[240px] truncate rounded-md border px-2 py-1 text-[11px] ${
            isFocused
              ? 'border-[#5b88c0] bg-[#11213a] text-[#d8e9ff]'
              : 'border-[#2a4468] bg-[#0b1a2e] text-[#94abd0]'
          }`}
          onClick={() => {
            onFocusPane(pane.id);
          }}
          title={pane.title}
          type="button"
        >
          {pane.title}
        </button>
        <span className="text-[10px] text-[#8ca2c5]">右键分屏</span>
      </div>
      <div className="min-h-0 flex-1">
        <div
          className="h-full min-h-[220px] w-full rounded-2xl border p-2"
          ref={hostRef}
          style={{
            borderColor,
            background: toRgba(surfaceHex, surfaceOpacity / 100),
            backdropFilter: `blur(${blurPx}px)`,
            WebkitBackdropFilter: `blur(${blurPx}px)`
          }}
        />
      </div>
    </div>
  );
}

export function OrbitTerminal({
  layout,
  activePaneId,
  isTabActive,
  onActivePaneChange,
  onPaneContextMenu,
  onPaneInput,
  onPaneSessionClosed,
  onTerminalError,
  fontFamily,
  fontSize,
  theme,
  surfaceHex,
  surfaceOpacity,
  blurPx,
  borderColor
}: OrbitTerminalProps): JSX.Element {
  const terminalApiMapRef = useRef<Map<string, TerminalInstanceApi>>(new Map());
  const fitRafRef = useRef<number>(0);

  const paneIds = useMemo(() => collectPaneIds(layout), [layout]);

  const fitAllTerminals = useCallback((): void => {
    for (const paneId of paneIds) {
      const api = terminalApiMapRef.current.get(paneId);
      api?.fit();
    }
  }, [paneIds]);

  const scheduleFitAll = useCallback((): void => {
    if (fitRafRef.current !== 0) {
      return;
    }
    fitRafRef.current = window.requestAnimationFrame(() => {
      fitRafRef.current = 0;
      fitAllTerminals();
    });
  }, [fitAllTerminals]);

  const registerApi = useCallback((paneId: string, api: TerminalInstanceApi | null): void => {
    if (!api) {
      terminalApiMapRef.current.delete(paneId);
      return;
    }
    terminalApiMapRef.current.set(paneId, api);
  }, []);

  useEffect(() => {
    const activeSet = new Set(paneIds);
    for (const paneId of terminalApiMapRef.current.keys()) {
      if (!activeSet.has(paneId)) {
        terminalApiMapRef.current.delete(paneId);
      }
    }
  }, [paneIds]);

  useEffect(() => {
    scheduleFitAll();
  }, [layout, scheduleFitAll]);

  useEffect(() => {
    if (!isTabActive) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      const activeApi = terminalApiMapRef.current.get(activePaneId);
      activeApi?.fit();
      activeApi?.focus();
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [activePaneId, isTabActive]);

  useEffect(() => {
    return () => {
      if (fitRafRef.current !== 0) {
        cancelAnimationFrame(fitRafRef.current);
        fitRafRef.current = 0;
      }
    };
  }, []);

  const renderNode = (node: TerminalLayoutNode): JSX.Element => {
    if (node.type === 'pane') {
      return (
        <TerminalInstance
          blurPx={blurPx}
          borderColor={borderColor}
          fontFamily={fontFamily}
          fontSize={fontSize}
          isFocused={isTabActive && activePaneId === node.pane.id}
          key={node.pane.id}
          onFocusPane={onActivePaneChange}
          onPaneContextMenu={onPaneContextMenu}
          onPaneInput={onPaneInput}
          onPaneSessionClosed={onPaneSessionClosed}
          onRegisterApi={registerApi}
          onTerminalError={onTerminalError}
          pane={node.pane}
          surfaceHex={surfaceHex}
          surfaceOpacity={surfaceOpacity}
          theme={theme}
        />
      );
    }

    return (
      <Group
        className="h-full w-full"
        key={node.id}
        orientation={node.direction}
      >
        <Panel defaultSize={node.sizes?.[0] ?? 50} minSize={12}>
          {renderNode(node.first)}
        </Panel>
        <Separator
          className={`rounded ${
            node.direction === 'horizontal'
              ? 'mx-1 w-1 cursor-col-resize bg-[#173255] hover:bg-[#2a568d]'
              : 'my-1 h-1 cursor-row-resize bg-[#173255] hover:bg-[#2a568d]'
          }`}
        />
        <Panel defaultSize={node.sizes?.[1] ?? 50} minSize={12}>
          {renderNode(node.second)}
        </Panel>
      </Group>
    );
  };

  return <div className="h-full min-h-0">{renderNode(layout)}</div>;
}
