import type { ITheme } from 'xterm';

export type LoyuThemePresetId = 'abyss' | 'midnight' | 'glacier';

export interface LoyuThemePreset {
  id: LoyuThemePresetId;
  name: string;
  description: string;
  bodyBackground: string;
  terminalSurfaceHex: string;
  terminalBorder: string;
  terminalTheme: ITheme;
}

const ABYSS_THEME: LoyuThemePreset = {
    id: 'abyss',
    name: '深屿蓝',
    description: '深邃蓝黑，适合长时间运维。',
    bodyBackground:
      'radial-gradient(circle at 12% 18%, rgba(106, 168, 255, 0.42), transparent 36%), radial-gradient(circle at 85% 12%, rgba(146, 200, 255, 0.34), transparent 30%), radial-gradient(circle at 50% 85%, rgba(178, 213, 255, 0.62), transparent 42%), linear-gradient(130deg, #e8f1ff 0%, #d5e7ff 48%, #f2f7ff 100%)',
    terminalSurfaceHex: '#05070b',
    terminalBorder: '#233a5a',
    terminalTheme: {
      background: '#05070b',
      foreground: '#d6e1ff',
      cursor: '#7db5ff',
      selectionBackground: '#20324f99',
      black: '#0f1117',
      red: '#ff6b81',
      green: '#7fe7b2',
      yellow: '#f7dc82',
      blue: '#3a7bff',
      magenta: '#6fa0ff',
      cyan: '#67d8ff',
      white: '#dce7ff',
      brightBlack: '#5a6374',
      brightRed: '#ff97a8',
      brightGreen: '#a4f0c8',
      brightYellow: '#ffe7a8',
      brightBlue: '#7aa6ff',
      brightMagenta: '#9cb9ff',
      brightCyan: '#9ae8ff',
      brightWhite: '#f4f7ff'
    }
  };

export const LOYU_THEME_PRESETS: ReadonlyArray<LoyuThemePreset> = [
  ABYSS_THEME,
  {
    id: 'midnight',
    name: '暮海黑',
    description: '更高对比度，突出命令输出。',
    bodyBackground:
      'radial-gradient(circle at 18% 12%, rgba(91, 138, 208, 0.38), transparent 33%), radial-gradient(circle at 80% 20%, rgba(68, 112, 188, 0.35), transparent 34%), linear-gradient(128deg, #dfe9f9 0%, #c7d9f3 45%, #eff4fb 100%)',
    terminalSurfaceHex: '#030509',
    terminalBorder: '#1b2b46',
    terminalTheme: {
      background: '#030509',
      foreground: '#e3ecff',
      cursor: '#8cb8ff',
      selectionBackground: '#29456c88',
      black: '#10131a',
      red: '#ff7f95',
      green: '#8df2be',
      yellow: '#f5dc95',
      blue: '#4d88ff',
      magenta: '#8aa2ff',
      cyan: '#77dcff',
      white: '#e7efff',
      brightBlack: '#5d6676',
      brightRed: '#ff9eb0',
      brightGreen: '#b0f7d0',
      brightYellow: '#ffebba',
      brightBlue: '#8cb1ff',
      brightMagenta: '#aebeff',
      brightCyan: '#a7e9ff',
      brightWhite: '#f7f9ff'
    }
  },
  {
    id: 'glacier',
    name: '霜川',
    description: '偏冷色玻璃质感，视觉更轻。',
    bodyBackground:
      'radial-gradient(circle at 14% 16%, rgba(167, 206, 255, 0.5), transparent 35%), radial-gradient(circle at 78% 14%, rgba(176, 222, 255, 0.42), transparent 32%), radial-gradient(circle at 46% 84%, rgba(214, 236, 255, 0.72), transparent 44%), linear-gradient(135deg, #edf5ff 0%, #dcecff 52%, #f4f9ff 100%)',
    terminalSurfaceHex: '#07101d',
    terminalBorder: '#29466e',
    terminalTheme: {
      background: '#07101d',
      foreground: '#d9e8ff',
      cursor: '#78b0ff',
      selectionBackground: '#35598588',
      black: '#111926',
      red: '#f48ca2',
      green: '#89e6c0',
      yellow: '#f2db9c',
      blue: '#4d8de6',
      magenta: '#7c9aeb',
      cyan: '#7fd9f4',
      white: '#e4efff',
      brightBlack: '#657184',
      brightRed: '#f8a9b8',
      brightGreen: '#aaf0d4',
      brightYellow: '#f7e7be',
      brightBlue: '#8fb4ff',
      brightMagenta: '#a8beff',
      brightCyan: '#aae9fb',
      brightWhite: '#f6faff'
    }
  }
];

export const resolveThemePreset = (id: LoyuThemePresetId): LoyuThemePreset => {
  return LOYU_THEME_PRESETS.find((preset) => preset.id === id) ?? ABYSS_THEME;
};

export const toRgba = (hex: string, alpha: number): string => {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    return `rgba(0, 0, 0, ${alpha})`;
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
