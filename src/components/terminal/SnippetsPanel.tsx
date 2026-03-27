import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Snippet } from '../../types/host';

interface SnippetsPanelProps {
  snippets: Snippet[];
  hasActiveSession: boolean;
  onRunSnippet: (command: string, autoEnter: boolean) => Promise<void>;
  onCreateSnippet: (payload: { title: string; command: string; tags: string[] }) => Promise<void>;
  onUpdateSnippet: (
    snippetId: string,
    payload: { title: string; command: string; tags: string[] }
  ) => Promise<void>;
  onDeleteSnippet: (snippetId: string) => Promise<void>;
}

interface SnippetFormState {
  title: string;
  command: string;
  tagsText: string;
}

const initialFormState: SnippetFormState = {
  title: '',
  command: '',
  tagsText: ''
};

const parseTags = (value: string): string[] => {
  if (!value.trim()) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
};

const previewCommand = (command: string): string => {
  const trimmed = command.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 64) {
    return trimmed;
  }
  return `${trimmed.slice(0, 64)}...`;
};

export function SnippetsPanel({
  snippets,
  hasActiveSession,
  onRunSnippet,
  onCreateSnippet,
  onUpdateSnippet,
  onDeleteSnippet
}: SnippetsPanelProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SnippetFormState>(initialFormState);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [runningSnippetId, setRunningSnippetId] = useState<string | null>(null);

  const filteredSnippets = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return snippets;
    }
    return snippets.filter((snippet) => {
      const searchable = [snippet.title, snippet.command, ...snippet.tags].join(' ').toLowerCase();
      return searchable.includes(query);
    });
  }, [search, snippets]);

  const editingSnippet = useMemo(() => {
    if (!editingId) {
      return null;
    }
    return snippets.find((item) => item.id === editingId) ?? null;
  }, [editingId, snippets]);

  const resetForm = (): void => {
    setForm(initialFormState);
    setEditingId(null);
  };

  const handleStartCreate = (): void => {
    setEditingId(null);
    setForm(initialFormState);
  };

  const handleStartEdit = (snippet: Snippet): void => {
    setEditingId(snippet.id);
    setForm({
      title: snippet.title,
      command: snippet.command,
      tagsText: snippet.tags.join(', ')
    });
  };

  const handleSaveSnippet = async (): Promise<void> => {
    const title = form.title.trim();
    const command = form.command.trim();
    if (!title) {
      toast.error('请输入指令标题。');
      return;
    }
    if (!command) {
      toast.error('请输入指令内容。');
      return;
    }

    setIsSubmitting(true);
    const payload = {
      title,
      command,
      tags: parseTags(form.tagsText)
    };
    try {
      if (editingSnippet) {
        await onUpdateSnippet(editingSnippet.id, payload);
      } else {
        await onCreateSnippet(payload);
      }
      resetForm();
    } catch (error) {
      const fallback = editingSnippet ? '更新指令失败。' : '新增指令失败。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (snippet: Snippet): Promise<void> => {
    const confirmed = window.confirm(`确认删除指令「${snippet.title}」吗？`);
    if (!confirmed) {
      return;
    }

    try {
      await onDeleteSnippet(snippet.id);
      if (editingId === snippet.id) {
        resetForm();
      }
    } catch (error) {
      const fallback = '删除指令失败。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    }
  };

  const handleRunSnippet = async (snippet: Snippet, autoEnter: boolean): Promise<void> => {
    if (!hasActiveSession) {
      toast.error('请先创建并激活终端会话。');
      return;
    }
    setRunningSnippetId(snippet.id);
    try {
      await onRunSnippet(snippet.command, autoEnter);
      toast.success(autoEnter ? `已执行：${snippet.title}` : `已填入：${snippet.title}`);
    } catch (error) {
      const fallback = '写入终端失败，请检查连接状态。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    } finally {
      setRunningSnippetId(null);
    }
  };

  if (collapsed) {
    return (
      <div className="absolute left-3 top-3 z-20">
        <button
          className="rounded-lg border border-[#5678aa] bg-[#0d1727]/95 px-3 py-2 text-xs font-semibold text-[#d9e7ff] shadow-lg hover:bg-[#11203a]"
          onClick={() => {
            setCollapsed(false);
          }}
          type="button"
        >
          展开指令库
        </button>
      </div>
    );
  }

  return (
    <aside className="absolute left-3 top-3 z-20 flex h-[calc(100%-1.5rem)] w-[320px] flex-col overflow-hidden rounded-2xl border border-[#314f77] bg-[#0b1320]/95 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-[#233856] px-3 py-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#83a9da]">Snippets</p>
          <p className="text-xs text-[#bfd3ef]">快捷指令片段</p>
        </div>
        <button
          className="rounded-md border border-[#4c719f] px-2 py-1 text-[11px] text-[#d3e3ff] hover:bg-[#15253f]"
          onClick={() => {
            setCollapsed(true);
          }}
          type="button"
        >
          收起
        </button>
      </div>

      <div className="border-b border-[#223754] p-3">
        <input
          className="w-full rounded-lg border border-[#35557f] bg-[#09101c] px-3 py-2 text-xs text-[#d9e7ff] outline-none placeholder:text-[#7290b4] focus:border-[#6a90c6]"
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder="搜索标题 / 指令 / 标签"
          type="search"
          value={search}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {filteredSnippets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#2f4a70] bg-[#0d1728]/70 px-3 py-4 text-xs text-[#9ab5d8]">
            暂无匹配指令。可在下方新建常用片段，例如 `tail -f /var/log/syslog`。
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSnippets.map((snippet) => {
              const isRunning = runningSnippetId === snippet.id;
              return (
                <article
                  className="rounded-xl border border-[#2f486e] bg-[#0e1a2b] p-3"
                  key={snippet.id}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#d8e6ff]">{snippet.title}</p>
                      <p className="mt-1 truncate text-[11px] text-[#8aa7ca]">{previewCommand(snippet.command)}</p>
                    </div>
                    <button
                      className="rounded border border-[#496a97] px-1.5 py-0.5 text-[10px] text-[#c9dcfb] hover:bg-[#182945]"
                      onClick={() => {
                        handleStartEdit(snippet);
                      }}
                      type="button"
                    >
                      编辑
                    </button>
                  </div>
                  {snippet.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {snippet.tags.map((tag) => (
                        <span
                          className="rounded border border-[#355784] bg-[#10233d] px-1.5 py-0.5 text-[10px] text-[#9ec0ee]"
                          key={`${snippet.id}-${tag}`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      className="rounded-md border border-[#4d6f9f] bg-[#13253f] px-2 py-1 text-[11px] text-[#d6e6ff] hover:bg-[#183255]"
                      disabled={isRunning}
                      onClick={() => {
                        void handleRunSnippet(snippet, false);
                      }}
                      type="button"
                    >
                      填入
                    </button>
                    <button
                      className="rounded-md border border-[#4f77ac] bg-[#1d3f69] px-2 py-1 text-[11px] text-[#f0f6ff] hover:bg-[#245188]"
                      disabled={isRunning}
                      onClick={() => {
                        void handleRunSnippet(snippet, true);
                      }}
                      type="button"
                    >
                      执行
                    </button>
                    <button
                      className="rounded-md border border-rose-400/70 bg-rose-600/15 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-600/25"
                      disabled={isRunning}
                      onClick={() => {
                        void handleDelete(snippet);
                      }}
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-[#223754] bg-[#0b1525] p-3">
        <p className="mb-2 text-xs font-semibold text-[#d1e3ff]">{editingSnippet ? '编辑指令' : '新建指令'}</p>
        <div className="space-y-2">
          <input
            className="w-full rounded-lg border border-[#35557f] bg-[#09101c] px-3 py-1.5 text-xs text-[#d9e7ff] outline-none placeholder:text-[#7290b4] focus:border-[#6a90c6]"
            maxLength={64}
            onChange={(event) => {
              setForm((prev) => ({ ...prev, title: event.target.value }));
            }}
            placeholder="标题，例如：查看 80 端口"
            type="text"
            value={form.title}
          />
          <textarea
            className="h-20 w-full resize-none rounded-lg border border-[#35557f] bg-[#09101c] px-3 py-2 text-xs text-[#d9e7ff] outline-none placeholder:text-[#7290b4] focus:border-[#6a90c6]"
            onChange={(event) => {
              setForm((prev) => ({ ...prev, command: event.target.value }));
            }}
            placeholder='指令内容，例如：lsof -i :80'
            value={form.command}
          />
          <input
            className="w-full rounded-lg border border-[#35557f] bg-[#09101c] px-3 py-1.5 text-xs text-[#d9e7ff] outline-none placeholder:text-[#7290b4] focus:border-[#6a90c6]"
            onChange={(event) => {
              setForm((prev) => ({ ...prev, tagsText: event.target.value }));
            }}
            placeholder="标签，逗号分隔：排障, 端口"
            type="text"
            value={form.tagsText}
          />
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg border border-[#4e76aa] bg-[#1d3f69] px-3 py-1.5 text-xs font-semibold text-[#f0f6ff] hover:bg-[#25538a] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              onClick={() => {
                void handleSaveSnippet();
              }}
              type="button"
            >
              {isSubmitting ? '保存中...' : editingSnippet ? '更新指令' : '添加指令'}
            </button>
            {(editingSnippet || form.title || form.command || form.tagsText) && (
              <button
                className="rounded-lg border border-[#4b6993] px-3 py-1.5 text-xs text-[#cde0ff] hover:bg-[#16253f]"
                onClick={handleStartCreate}
                type="button"
              >
                重置
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
