import { LOYU_THEME_PRESETS } from '../../theme/loyuTheme';
import { useUiSettingsStore } from '../../store/useUiSettingsStore';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenAbout: () => void;
}

const FONT_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  {
    label: 'Sarasa Mono SC (默认)',
    value: 'Sarasa Mono SC, JetBrains Mono, Menlo, Monaco, monospace'
  },
  {
    label: 'JetBrains Mono',
    value: 'JetBrains Mono, Sarasa Mono SC, Menlo, Monaco, monospace'
  },
  {
    label: 'SF Mono',
    value: 'SFMono-Regular, SF Mono, Menlo, Monaco, monospace'
  },
  {
    label: 'Fira Code',
    value: 'Fira Code, JetBrains Mono, Menlo, Monaco, monospace'
  }
];

export function SettingsDrawer({
  open,
  onClose,
  onOpenAbout
}: SettingsDrawerProps): JSX.Element | null {
  const terminalFontSize = useUiSettingsStore((state) => state.terminalFontSize);
  const terminalFontFamily = useUiSettingsStore((state) => state.terminalFontFamily);
  const terminalOpacity = useUiSettingsStore((state) => state.terminalOpacity);
  const terminalBlur = useUiSettingsStore((state) => state.terminalBlur);
  const themePresetId = useUiSettingsStore((state) => state.themePresetId);
  const autoLockEnabled = useUiSettingsStore((state) => state.autoLockEnabled);
  const setTerminalFontSize = useUiSettingsStore((state) => state.setTerminalFontSize);
  const setTerminalFontFamily = useUiSettingsStore((state) => state.setTerminalFontFamily);
  const setTerminalOpacity = useUiSettingsStore((state) => state.setTerminalOpacity);
  const setTerminalBlur = useUiSettingsStore((state) => state.setTerminalBlur);
  const setThemePresetId = useUiSettingsStore((state) => state.setThemePresetId);
  const setAutoLockEnabled = useUiSettingsStore((state) => state.setAutoLockEnabled);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-black/25 backdrop-blur-[2px]">
      <button
        aria-label="关闭设置"
        className="flex-1 cursor-default"
        onClick={onClose}
        type="button"
      />
      <aside className="h-full w-full max-w-md border-l border-white/30 bg-[#f2f7ff]/90 p-5 shadow-2xl backdrop-blur-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">设置中心</h2>
          <button
            className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-white/70"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <section className="space-y-2 rounded-xl border border-white/60 bg-white/60 p-3">
            <h3 className="text-sm font-semibold text-slate-800">终端字体</h3>
            <label className="block text-xs text-slate-600" htmlFor="terminal-font-family">
              字体家族
            </label>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300"
              id="terminal-font-family"
              onChange={(event) => setTerminalFontFamily(event.target.value)}
              value={terminalFontFamily}
            >
              {FONT_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>字体大小</span>
              <span>{terminalFontSize}px</span>
            </div>
            <input
              className="w-full accent-[#2f6df4]"
              max={22}
              min={11}
              onChange={(event) => setTerminalFontSize(Number(event.target.value))}
              step={1}
              type="range"
              value={terminalFontSize}
            />
          </section>

          <section className="space-y-2 rounded-xl border border-white/60 bg-white/60 p-3">
            <h3 className="text-sm font-semibold text-slate-800">Acrylic / Blur</h3>
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>终端背景透明度</span>
              <span>{terminalOpacity}%</span>
            </div>
            <input
              className="w-full accent-[#2f6df4]"
              max={100}
              min={50}
              onChange={(event) => setTerminalOpacity(Number(event.target.value))}
              step={1}
              type="range"
              value={terminalOpacity}
            />

            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>磨砂强度</span>
              <span>{terminalBlur}px</span>
            </div>
            <input
              className="w-full accent-[#2f6df4]"
              max={28}
              min={0}
              onChange={(event) => setTerminalBlur(Number(event.target.value))}
              step={1}
              type="range"
              value={terminalBlur}
            />
          </section>

          <section className="space-y-2 rounded-xl border border-white/60 bg-white/60 p-3">
            <h3 className="text-sm font-semibold text-slate-800">主题配色</h3>
            <div className="space-y-2">
              {LOYU_THEME_PRESETS.map((preset) => (
                <button
                  className={`w-full rounded-lg border px-3 py-2 text-left ${
                    preset.id === themePresetId
                      ? 'border-[#2f6df4] bg-[#eaf1ff]'
                      : 'border-white/70 bg-white/80 hover:border-slate-200'
                  }`}
                  key={preset.id}
                  onClick={() => setThemePresetId(preset.id)}
                  type="button"
                >
                  <p className="text-sm font-medium text-slate-800">{preset.name}</p>
                  <p className="mt-0.5 text-xs text-slate-600">{preset.description}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2 rounded-xl border border-white/60 bg-white/60 p-3">
            <h3 className="text-sm font-semibold text-slate-800">安全</h3>
            <label className="flex items-start gap-3">
              <input
                checked={autoLockEnabled}
                className="mt-0.5 h-4 w-4 accent-[#2f6df4]"
                onChange={(event) => setAutoLockEnabled(event.target.checked)}
                type="checkbox"
              />
              <span className="text-xs text-slate-700">
                App 隐藏或闲置 5 分钟后自动锁定金库（推荐开启）。
              </span>
            </label>
          </section>

          <section className="space-y-2 rounded-xl border border-white/60 bg-white/60 p-3">
            <h3 className="text-sm font-semibold text-slate-800">关于</h3>
            <p className="text-xs text-slate-700">查看版本信息、开源致谢与更新检查。</p>
            <button
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              onClick={onOpenAbout}
              type="button"
            >
              关于罗屿
            </button>
          </section>
        </div>
      </aside>
    </div>
  );
}
