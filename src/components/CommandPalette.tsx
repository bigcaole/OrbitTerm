import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export type CommandPaletteItemKind = 'host' | 'snippet' | 'setting' | 'action';

export interface CommandPaletteItem {
  id: string;
  kind: CommandPaletteItemKind;
  title: string;
  subtitle?: string;
  hint?: string;
}

interface CommandPaletteProps {
  open: boolean;
  query: string;
  items: CommandPaletteItem[];
  activeIndex: number;
  onQueryChange: (value: string) => void;
  onActiveIndexChange: (nextIndex: number) => void;
  onConfirm: (item: CommandPaletteItem) => void;
  onClose: () => void;
}

const kindLabelMap: Record<CommandPaletteItemKind, string> = {
  host: '主机',
  snippet: '片段',
  setting: '设置',
  action: '操作'
};

export function CommandPalette({
  open,
  query,
  items,
  activeIndex,
  onQueryChange,
  onActiveIndexChange,
  onConfirm,
  onClose
}: CommandPaletteProps): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (items.length === 0) {
      if (activeIndex !== -1) {
        onActiveIndexChange(-1);
      }
      return;
    }
    if (activeIndex < 0 || activeIndex >= items.length) {
      onActiveIndexChange(0);
    }
  }, [activeIndex, items, onActiveIndexChange, open]);

  if (!open) {
    return null;
  }

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (items.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
      onActiveIndexChange(next);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
      onActiveIndexChange(next);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const target = items[activeIndex] ?? items[0];
      if (!target) {
        return;
      }
      onConfirm(target);
    }
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-[#020617]/45 p-4 backdrop-blur-md">
      <button
        aria-label="关闭命令面板"
        className="absolute inset-0 h-full w-full"
        onClick={onClose}
        type="button"
      />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-[#3e73bf]/55 bg-[linear-gradient(145deg,rgba(7,20,38,0.92),rgba(8,14,25,0.88))] shadow-[0_24px_70px_rgba(8,24,48,0.55)] backdrop-blur-2xl">
        <div className="border-b border-[#2a4e7b]/65 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#82b8ff]">
            OrbitTerm Command Palette
          </p>
          <input
            className="mt-2 w-full rounded-xl border border-[#315987] bg-[#081528]/80 px-4 py-3 text-sm text-[#e5f0ff] outline-none ring-[#4f9bff]/35 placeholder:text-[#7aa2d0] focus:ring-2"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="搜索主机、指令片段、设置项…"
            ref={inputRef}
            value={query}
          />
          <p className="mt-2 text-[11px] text-[#84a8d1]">上下选择，Enter 执行，Esc 关闭</p>
        </div>
        <div className="max-h-[46vh] overflow-auto px-2 py-2">
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#3a5f8f] bg-[#081528]/45 px-4 py-6 text-center text-sm text-[#96b5da]">
              未找到匹配项，换个关键词试试。
            </div>
          ) : (
            items.map((item, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  className={`mb-1.5 w-full rounded-xl border px-3 py-2 text-left transition ${
                    isActive
                      ? 'border-[#5fa8ff] bg-[#102846] text-[#e8f3ff] shadow-[0_0_0_1px_rgba(95,168,255,0.35)]'
                      : 'border-[#2b466b] bg-[#071426]/80 text-[#bdd6f3] hover:bg-[#0d1f36]'
                  }`}
                  key={item.id}
                  onClick={() => onConfirm(item)}
                  onMouseEnter={() => onActiveIndexChange(index)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      {item.subtitle ? (
                        <p className="mt-0.5 truncate text-xs text-[#89acd5]">{item.subtitle}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="rounded-md border border-[#3f6596] bg-[#10233f] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[#8fc0ff]">
                        {kindLabelMap[item.kind]}
                      </span>
                      {item.hint ? <p className="mt-1 text-[10px] text-[#6f96c4]">{item.hint}</p> : null}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
