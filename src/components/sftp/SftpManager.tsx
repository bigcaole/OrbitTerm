import { useEffect, useMemo, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/api/dialog';
import { toast } from 'sonner';
import {
  type SftpEntry,
  type SftpTransferProgressEvent,
  sftpDownload,
  sftpLs,
  sftpMkdir,
  sftpRename,
  sftpRm,
  sftpUpload
} from '../../services/sftp';

interface SftpManagerProps {
  sessionId: string | null;
  syncRequest: SftpSyncRequest | null;
  onSendToTerminal: (command: string, execute: boolean) => Promise<void>;
  className?: string;
}

interface ContextMenuState {
  entry: SftpEntry;
  x: number;
  y: number;
}

interface SftpSyncRequest {
  sessionId: string;
  path: string;
  nonce: number;
}

interface BreadcrumbItem {
  label: string;
  path: string;
}

interface VirtualWindow {
  start: number;
  end: number;
  topSpacer: number;
  bottomSpacer: number;
}

const VIRTUAL_LIST_THRESHOLD = 1000;
const VIRTUAL_ROW_HEIGHT = 36;
const VIRTUAL_OVERSCAN = 8;

const joinRemotePath = (base: string, name: string): string => {
  if (base === '/') {
    return `/${name}`;
  }
  if (base.endsWith('/')) {
    return `${base}${name}`;
  }
  return `${base}/${name}`;
};

const basename = (path: string): string => {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || 'upload.bin';
};

const escapeShellPath = (path: string): string => {
  return path.replace(/["\\$`]/g, '\\$&');
};

const buildBreadcrumbs = (path: string): BreadcrumbItem[] => {
  if (!path.startsWith('/')) {
    return [{ label: path || '.', path: path || '.' }];
  }

  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) {
    return [{ label: '/', path: '/' }];
  }

  const result: BreadcrumbItem[] = [{ label: '/', path: '/' }];
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    result.push({
      label: part,
      path: current
    });
  }

  return result;
};

const scriptRunCommand = (entry: SftpEntry): string | null => {
  if (entry.isDir) {
    return null;
  }

  const lower = entry.name.toLowerCase();
  if (lower.endsWith('.sh')) {
    return `bash "${escapeShellPath(entry.path)}"`;
  }
  if (lower.endsWith('.py')) {
    return `python3 "${escapeShellPath(entry.path)}"`;
  }
  return null;
};

const iconForEntry = (entry: SftpEntry): string => {
  if (entry.isDir) {
    return '📁';
  }
  const ext = entry.name.toLowerCase().split('.').pop() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return '🖼️';
  }
  if (['sh', 'bash', 'zsh', 'ps1'].includes(ext)) {
    return '🧩';
  }
  if (['js', 'ts', 'tsx', 'rs', 'go', 'py', 'java', 'cpp', 'c', 'h'].includes(ext)) {
    return '📜';
  }
  if (['zip', 'tar', 'gz', '7z'].includes(ext)) {
    return '🗜️';
  }
  return '📄';
};

const readableSize = (size: number): string => {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

const readableTime = (ts: number | null): string => {
  if (!ts) {
    return '-';
  }
  return new Date(ts * 1000).toLocaleString();
};

export function SftpManager({
  sessionId,
  syncRequest,
  onSendToTerminal,
  className
}: SftpManagerProps): JSX.Element {
  const [currentPath, setCurrentPath] = useState<string>('/');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [scrollTop, setScrollTop] = useState<number>(0);
  const [viewportHeight, setViewportHeight] = useState<number>(240);
  const completedUploadKeysRef = useRef<Set<string>>(new Set());
  const listViewportRef = useRef<HTMLDivElement | null>(null);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.isDir !== b.isDir) {
        return a.isDir ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }, [entries]);

  const breadcrumbs = useMemo(() => {
    return buildBreadcrumbs(currentPath);
  }, [currentPath]);

  const isVirtualList = sortedEntries.length > VIRTUAL_LIST_THRESHOLD;

  const virtualWindow = useMemo<VirtualWindow>(() => {
    if (!isVirtualList) {
      return {
        start: 0,
        end: sortedEntries.length,
        topSpacer: 0,
        bottomSpacer: 0
      };
    }

    const total = sortedEntries.length;
    const rawStart = Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT);
    const visibleCount = Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT);

    const start = Math.max(0, rawStart - VIRTUAL_OVERSCAN);
    const end = Math.min(total, rawStart + visibleCount + VIRTUAL_OVERSCAN);
    const topSpacer = start * VIRTUAL_ROW_HEIGHT;
    const bottomSpacer = Math.max(0, (total - end) * VIRTUAL_ROW_HEIGHT);

    return {
      start,
      end,
      topSpacer,
      bottomSpacer
    };
  }, [isVirtualList, scrollTop, sortedEntries.length, viewportHeight]);

  const visibleEntries = useMemo(() => {
    if (!isVirtualList) {
      return sortedEntries;
    }
    return sortedEntries.slice(virtualWindow.start, virtualWindow.end);
  }, [isVirtualList, sortedEntries, virtualWindow.end, virtualWindow.start]);

  const reportError = (message: string): void => {
    setError(message);
    toast.error(message, {
      description: 'SFTP 操作未完成，请检查路径或权限后重试。'
    });
  };

  const loadDirectory = async (path: string): Promise<void> => {
    if (!sessionId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await sftpLs(sessionId, path);
      setCurrentPath(res.path);
      setEntries(res.entries);
    } catch (err) {
      const message = err instanceof Error ? err.message : '读取目录失败。';
      reportError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!sessionId) {
      setEntries([]);
      setCurrentPath('/');
      setError(null);
      return;
    }
    void loadDirectory('.');
  }, [sessionId]);

  useEffect(() => {
    const closeMenu = (): void => setMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    void listen<SftpTransferProgressEvent>('sftp-upload-progress', (event) => {
      if (disposed || !sessionId || event.payload.sessionId !== sessionId) {
        return;
      }

      const key = `${event.payload.localPath}=>${event.payload.remotePath}`;
      setUploadProgress((prev) => ({
        ...prev,
        [key]: event.payload.progress
      }));

      if (event.payload.progress >= 100) {
        if (!completedUploadKeysRef.current.has(key)) {
          completedUploadKeysRef.current.add(key);
          toast.success(`上传完成：${basename(event.payload.localPath)}`);
        }
        window.setTimeout(() => {
          setUploadProgress((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          completedUploadKeysRef.current.delete(key);
          void loadDirectory(currentPath);
        }, 500);
      }
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
  }, [sessionId, currentPath]);

  useEffect(() => {
    if (!sessionId || !syncRequest) {
      return;
    }
    if (syncRequest.sessionId !== sessionId) {
      return;
    }

    void loadDirectory(syncRequest.path);
  }, [sessionId, syncRequest]);

  useEffect(() => {
    setScrollTop(0);
    const node = listViewportRef.current;
    if (node) {
      node.scrollTop = 0;
    }
  }, [sessionId, currentPath]);

  useEffect(() => {
    const node = listViewportRef.current;
    if (!node) {
      return;
    }

    const syncHeight = (): void => {
      setViewportHeight(node.clientHeight || 240);
    };

    syncHeight();
    const resizeObserverSupported =
      typeof window !== 'undefined' && typeof window.ResizeObserver !== 'undefined';
    const observer = resizeObserverSupported ? new ResizeObserver(syncHeight) : null;
    if (observer) {
      observer.observe(node);
    } else {
      window.addEventListener('resize', syncHeight);
    }

    return () => {
      if (observer) {
        observer.disconnect();
      } else {
        window.removeEventListener('resize', syncHeight);
      }
    };
  }, [sessionId, loading, sortedEntries.length]);

  const handleEnter = (entry: SftpEntry): void => {
    if (!entry.isDir) {
      return;
    }
    void loadDirectory(entry.path);
  };

  const handleCreateFolder = async (): Promise<void> => {
    if (!sessionId) {
      return;
    }
    const folderName = window.prompt('请输入新文件夹名称：', 'new-folder');
    if (!folderName) {
      return;
    }
    const targetPath = joinRemotePath(currentPath, folderName.trim());
    if (!targetPath.trim()) {
      return;
    }
    try {
      await sftpMkdir(sessionId, targetPath);
      await loadDirectory(currentPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : '创建文件夹失败。';
      reportError(message);
    }
  };

  const handleUpload = async (): Promise<void> => {
    if (!sessionId) {
      return;
    }
    const selected = await open({
      multiple: true,
      directory: false
    });

    if (!selected) {
      return;
    }

    const localPaths = Array.isArray(selected) ? selected : [selected];
    for (const localPath of localPaths) {
      const name = basename(localPath);
      const remotePath = joinRemotePath(currentPath, name);
      try {
        await sftpUpload(sessionId, localPath, remotePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : `上传 ${name} 失败。`;
        reportError(message);
        break;
      }
    }
    await loadDirectory(currentPath);
  };

  const handleDownload = async (entry: SftpEntry): Promise<void> => {
    if (!sessionId) {
      return;
    }
    if (entry.isDir) {
      reportError('暂不支持直接下载目录，请先进入目录选择文件。');
      return;
    }
    const savePath = await save({
      defaultPath: entry.name
    });
    if (!savePath || Array.isArray(savePath)) {
      return;
    }
    try {
      await sftpDownload(sessionId, entry.path, savePath);
      toast.success(`已下载 ${entry.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '下载失败。';
      reportError(message);
    }
  };

  const handleDelete = async (entry: SftpEntry): Promise<void> => {
    if (!sessionId) {
      return;
    }
    const confirmed = window.confirm(
      entry.isDir
        ? `确认删除目录「${entry.name}」及其内容吗？`
        : `确认删除文件「${entry.name}」吗？`
    );
    if (!confirmed) {
      return;
    }
    try {
      await sftpRm(sessionId, entry.path, entry.isDir);
      await loadDirectory(currentPath);
      toast.success(`已删除 ${entry.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除失败。';
      reportError(message);
    }
  };

  const handleRename = async (entry: SftpEntry): Promise<void> => {
    if (!sessionId) {
      return;
    }
    const nextName = window.prompt('请输入新名称：', entry.name);
    if (!nextName || !nextName.trim()) {
      return;
    }
    const toPath = joinRemotePath(currentPath, nextName.trim());
    try {
      await sftpRename(sessionId, entry.path, toPath);
      await loadDirectory(currentPath);
      toast.success(`已重命名为 ${nextName.trim()}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '重命名失败。';
      reportError(message);
    }
  };

  const handleCopyPath = async (entry: SftpEntry): Promise<void> => {
    try {
      await navigator.clipboard.writeText(entry.path);
      toast.success('路径已复制到剪贴板');
    } catch (_err) {
      reportError('复制路径失败，请检查系统剪贴板权限。');
    }
  };

  const handleOpenInTerminal = async (entry: SftpEntry): Promise<void> => {
    if (!entry.isDir) {
      return;
    }
    const targetPath = entry.path;
    const command = `cd "${escapeShellPath(targetPath)}"`;
    try {
      await onSendToTerminal(command, true);
      toast.success(`终端已切换到 ${targetPath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '写入终端失败。';
      reportError(message);
    }
  };

  const handleRunScript = async (entry: SftpEntry): Promise<void> => {
    const command = scriptRunCommand(entry);
    if (!command) {
      return;
    }

    try {
      await onSendToTerminal(command, true);
      toast.success(`已在终端执行：${entry.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '执行脚本失败。';
      reportError(message);
    }
  };

  const renderRow = (entry: SftpEntry): JSX.Element => {
    return (
      <button
        className="grid w-full grid-cols-[2.3fr_0.9fr_1.4fr] items-center border-t border-[#11233a] px-3 text-left text-xs text-[#d4e1f7] hover:bg-[#10213a]"
        key={entry.path}
        onClick={() => {
          handleEnter(entry);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({
            entry,
            x: event.clientX,
            y: event.clientY
          });
        }}
        style={{ height: `${VIRTUAL_ROW_HEIGHT}px` }}
        type="button"
      >
        <span className="truncate">
          {iconForEntry(entry)} {entry.name}
        </span>
        <span className="text-[#95aaca]">{entry.isDir ? '-' : readableSize(entry.size)}</span>
        <span className="text-[#95aaca]">{readableTime(entry.modifiedAt)}</span>
      </button>
    );
  };

  return (
    <section className={`flex h-full min-h-0 flex-col rounded-2xl border border-[#2a3f61] bg-[#06101d] p-3 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8ea5c7]">SFTP Manager</p>
          <p className="truncate text-xs text-[#c8d8f3]">{sessionId ? currentPath : '请先建立 SSH 会话'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-md border border-[#39537a] bg-[#0e1a2d] px-2.5 py-1 text-xs text-[#d7e5ff] hover:bg-[#172742]"
            disabled={!sessionId || loading}
            onClick={() => {
              void loadDirectory(currentPath);
            }}
            type="button"
          >
            刷新
          </button>
          <button
            className="rounded-md border border-[#39537a] bg-[#0e1a2d] px-2.5 py-1 text-xs text-[#d7e5ff] hover:bg-[#172742]"
            disabled={!sessionId}
            onClick={() => {
              void handleCreateFolder();
            }}
            type="button"
          >
            新建目录
          </button>
          <button
            className="rounded-md border border-[#39537a] bg-[#0e1a2d] px-2.5 py-1 text-xs text-[#d7e5ff] hover:bg-[#172742]"
            disabled={!sessionId}
            onClick={() => {
              void handleUpload();
            }}
            type="button"
          >
            上传文件
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1 rounded-lg border border-[#223a5f] bg-[#0a182b] px-2 py-1">
        {breadcrumbs.map((item, index) => (
          <button
            className="rounded px-1.5 py-0.5 text-[11px] text-[#b8cae6] hover:bg-[#153056] hover:text-white"
            key={`${item.path}-${index}`}
            onClick={() => {
              void loadDirectory(item.path);
            }}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {Object.keys(uploadProgress).length > 0 && (
        <div className="mt-3 space-y-2">
          {Object.entries(uploadProgress).map(([key, progress]) => (
            <div className="space-y-1" key={key}>
              <div className="flex items-center justify-between text-[11px] text-[#b8cae6]">
                <span className="truncate">{key}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 rounded bg-[#1a2a42]">
                <div className="h-1.5 rounded bg-[#3a7bff]" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {sessionId && !loading && isVirtualList && (
        <p className="mt-2 text-[11px] text-[#7fa0ca]">
          当前目录包含 {sortedEntries.length} 项，已启用虚拟滚动以提升性能。
        </p>
      )}

      <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#263d60]">
        <div className="grid grid-cols-[2.3fr_0.9fr_1.4fr] bg-[#0f1d31] px-3 py-2 text-[11px] font-semibold text-[#9cb1cf]">
          <span>名称</span>
          <span>大小</span>
          <span>修改时间</span>
        </div>
        <div
          className="h-full min-h-0 overflow-auto bg-[#071323]"
          onScroll={(event) => {
            if (isVirtualList) {
              setScrollTop(event.currentTarget.scrollTop);
            }
          }}
          ref={listViewportRef}
        >
          {!sessionId && <p className="px-3 py-4 text-xs text-[#8ea5c7]">连接终端后即可浏览远程文件。</p>}
          {sessionId && loading && <p className="px-3 py-4 text-xs text-[#8ea5c7]">正在读取目录...</p>}

          {sessionId && !loading && sortedEntries.length > 0 && !isVirtualList && (
            <>{visibleEntries.map((entry) => renderRow(entry))}</>
          )}

          {sessionId && !loading && sortedEntries.length > 0 && isVirtualList && (
            <div>
              {virtualWindow.topSpacer > 0 && (
                <div style={{ height: `${virtualWindow.topSpacer}px` }} />
              )}
              {visibleEntries.map((entry) => renderRow(entry))}
              {virtualWindow.bottomSpacer > 0 && (
                <div style={{ height: `${virtualWindow.bottomSpacer}px` }} />
              )}
            </div>
          )}

          {sessionId && !loading && sortedEntries.length === 0 && (
            <p className="px-3 py-4 text-xs text-[#8ea5c7]">目录为空。</p>
          )}
        </div>
      </div>

      {menu && (
        <div
          className="fixed z-50 min-w-[150px] rounded-lg border border-[#38557f] bg-[#0f1d31] p-1 text-xs text-[#d4e1f7] shadow-xl"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="block w-full rounded px-2 py-1 text-left hover:bg-[#1c2f4d]"
            onClick={() => {
              void handleDownload(menu.entry);
              setMenu(null);
            }}
            type="button"
          >
            下载
          </button>
          {menu.entry.isDir && (
            <button
              className="block w-full rounded px-2 py-1 text-left hover:bg-[#1c2f4d]"
              onClick={() => {
                void handleOpenInTerminal(menu.entry);
                setMenu(null);
              }}
              type="button"
            >
              在终端中打开
            </button>
          )}
          {scriptRunCommand(menu.entry) && (
            <button
              className="block w-full rounded px-2 py-1 text-left hover:bg-[#1c2f4d]"
              onClick={() => {
                void handleRunScript(menu.entry);
                setMenu(null);
              }}
              type="button"
            >
              在终端运行
            </button>
          )}
          <button
            className="block w-full rounded px-2 py-1 text-left hover:bg-[#1c2f4d]"
            onClick={() => {
              void handleRename(menu.entry);
              setMenu(null);
            }}
            type="button"
          >
            重命名
          </button>
          <button
            className="block w-full rounded px-2 py-1 text-left hover:bg-[#1c2f4d]"
            onClick={() => {
              void handleDelete(menu.entry);
              setMenu(null);
            }}
            type="button"
          >
            删除
          </button>
          <button
            className="block w-full rounded px-2 py-1 text-left hover:bg-[#1c2f4d]"
            onClick={() => {
              void handleCopyPath(menu.entry);
              setMenu(null);
            }}
            type="button"
          >
            复制路径
          </button>
        </div>
      )}
    </section>
  );
}
