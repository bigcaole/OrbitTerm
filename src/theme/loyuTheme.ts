import type { ITheme } from 'xterm';

export type LoyuThemePresetId = 'abyss' | 'midnight' | 'glacier' | 'lagoon' | 'aurora' | 'maple';

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
  description: '低眩光深蓝基底，命令颜色更清透。',
  bodyBackground:
    'radial-gradient(circle at 12% 18%, rgba(106, 168, 255, 0.42), transparent 36%), radial-gradient(circle at 85% 12%, rgba(146, 200, 255, 0.34), transparent 30%), radial-gradient(circle at 50% 85%, rgba(178, 213, 255, 0.62), transparent 42%), linear-gradient(130deg, #e8f1ff 0%, #d5e7ff 48%, #f2f7ff 100%)',
  terminalSurfaceHex: '#0b1220',
  terminalBorder: '#2e4670',
  terminalTheme: {
    background: '#0b1220',
    foreground: '#dbe7ff',
    cursor: '#7ab7ff',
    selectionBackground: '#29456d88',
    black: '#1a2435',
    red: '#ff7f9a',
    green: '#7fecc0',
    yellow: '#f5dc83',
    blue: '#6fa8ff',
    magenta: '#9c9dff',
    cyan: '#73e0ff',
    white: '#dbe7ff',
    brightBlack: '#647089',
    brightRed: '#ff9db2',
    brightGreen: '#a3f4d5',
    brightYellow: '#ffedb3',
    brightBlue: '#9ac2ff',
    brightMagenta: '#b9bbff',
    brightCyan: '#a0ecff',
    brightWhite: '#f2f7ff'
  }
};

export const LOYU_THEME_PRESETS: ReadonlyArray<LoyuThemePreset> = [
  ABYSS_THEME,
  {
    id: 'midnight',
    name: '暮海',
    description: '对比更强但不刺眼，适合密集排错。',
    bodyBackground:
      'radial-gradient(circle at 18% 12%, rgba(91, 138, 208, 0.38), transparent 33%), radial-gradient(circle at 80% 20%, rgba(68, 112, 188, 0.35), transparent 34%), linear-gradient(128deg, #dfe9f9 0%, #c7d9f3 45%, #eff4fb 100%)',
    terminalSurfaceHex: '#121a2c',
    terminalBorder: '#2f4265',
    terminalTheme: {
      background: '#121a2c',
      foreground: '#e6efff',
      cursor: '#8dc2ff',
      selectionBackground: '#36537a8f',
      black: '#1e2638',
      red: '#ff8797',
      green: '#86edbf',
      yellow: '#f6dd8f',
      blue: '#77adff',
      magenta: '#a6a8ff',
      cyan: '#78e6ff',
      white: '#e6efff',
      brightBlack: '#6a7590',
      brightRed: '#ffadb9',
      brightGreen: '#adf5d8',
      brightYellow: '#ffeeb8',
      brightBlue: '#9fc7ff',
      brightMagenta: '#c3c5ff',
      brightCyan: '#a8f1ff',
      brightWhite: '#f4f8ff'
    }
  },
  {
    id: 'glacier',
    name: '霜川',
    description: '冷色玻璃感，长时间阅读负担更低。',
    bodyBackground:
      'radial-gradient(circle at 14% 16%, rgba(167, 206, 255, 0.5), transparent 35%), radial-gradient(circle at 78% 14%, rgba(176, 222, 255, 0.42), transparent 32%), radial-gradient(circle at 46% 84%, rgba(214, 236, 255, 0.72), transparent 44%), linear-gradient(135deg, #edf5ff 0%, #dcecff 52%, #f4f9ff 100%)',
    terminalSurfaceHex: '#102033',
    terminalBorder: '#33557e',
    terminalTheme: {
      background: '#102033',
      foreground: '#deedff',
      cursor: '#81bfff',
      selectionBackground: '#40628f80',
      black: '#223149',
      red: '#f58fa8',
      green: '#8be6c4',
      yellow: '#f4e0a3',
      blue: '#78afee',
      magenta: '#9eb0f0',
      cyan: '#88ddf6',
      white: '#e5f1ff',
      brightBlack: '#6f7f99',
      brightRed: '#f7adbe',
      brightGreen: '#acefd6',
      brightYellow: '#f9eac2',
      brightBlue: '#9fc2ff',
      brightMagenta: '#c0ccff',
      brightCyan: '#b1ecff',
      brightWhite: '#f7fbff'
    }
  },
  {
    id: 'lagoon',
    name: '青湾',
    description: '蓝绿系低亮度背景，日志颜色鲜明。',
    bodyBackground:
      'radial-gradient(circle at 16% 18%, rgba(142, 222, 232, 0.38), transparent 34%), radial-gradient(circle at 82% 20%, rgba(145, 196, 255, 0.34), transparent 35%), linear-gradient(132deg, #e2f6f8 0%, #d4eaf6 46%, #edf7fb 100%)',
    terminalSurfaceHex: '#10242c',
    terminalBorder: '#2d6673',
    terminalTheme: {
      background: '#10242c',
      foreground: '#dbf5ff',
      cursor: '#72d6ff',
      selectionBackground: '#2b55617f',
      black: '#1a323b',
      red: '#ff8b9d',
      green: '#69efc2',
      yellow: '#f7de8c',
      blue: '#73beff',
      magenta: '#9cb4ff',
      cyan: '#6deaf4',
      white: '#dff4ff',
      brightBlack: '#64848d',
      brightRed: '#ffb0bf',
      brightGreen: '#97f5d8',
      brightYellow: '#ffedb5',
      brightBlue: '#9bd2ff',
      brightMagenta: '#bdccff',
      brightCyan: '#9bf3ff',
      brightWhite: '#f2fbff'
    }
  },
  {
    id: 'aurora',
    name: '极光',
    description: '偏紫蓝极光氛围，命令语法更灵动。',
    bodyBackground:
      'radial-gradient(circle at 14% 16%, rgba(186, 170, 255, 0.34), transparent 35%), radial-gradient(circle at 84% 18%, rgba(131, 198, 255, 0.34), transparent 33%), linear-gradient(132deg, #ececff 0%, #dde4ff 48%, #f5f5ff 100%)',
    terminalSurfaceHex: '#1a1830',
    terminalBorder: '#4a4a80',
    terminalTheme: {
      background: '#1a1830',
      foreground: '#ebe9ff',
      cursor: '#a6b2ff',
      selectionBackground: '#4a4f8c81',
      black: '#272441',
      red: '#ff8ea9',
      green: '#7fe9c1',
      yellow: '#f6dc97',
      blue: '#7caeff',
      magenta: '#c2a0ff',
      cyan: '#86e6ff',
      white: '#ecebff',
      brightBlack: '#807a9f',
      brightRed: '#ffb1c3',
      brightGreen: '#a6f2d7',
      brightYellow: '#ffebbc',
      brightBlue: '#a2c7ff',
      brightMagenta: '#d8c1ff',
      brightCyan: '#b3efff',
      brightWhite: '#f8f6ff'
    }
  },
  {
    id: 'maple',
    name: '枫砂',
    description: '暖色护眼主题，减少纯冷色疲劳。',
    bodyBackground:
      'radial-gradient(circle at 14% 16%, rgba(255, 208, 165, 0.35), transparent 36%), radial-gradient(circle at 82% 18%, rgba(255, 183, 159, 0.28), transparent 34%), linear-gradient(132deg, #fff3ea 0%, #fee9dc 48%, #fff7f2 100%)',
    terminalSurfaceHex: '#2a1f1a',
    terminalBorder: '#845f4f',
    terminalTheme: {
      background: '#2a1f1a',
      foreground: '#ffe9dc',
      cursor: '#ffb47d',
      selectionBackground: '#6e4e3d84',
      black: '#3a2b24',
      red: '#ff9a8f',
      green: '#8ee4b8',
      yellow: '#f3d694',
      blue: '#88bfff',
      magenta: '#f0a3d6',
      cyan: '#8be6ee',
      white: '#ffe9dc',
      brightBlack: '#9c7f73',
      brightRed: '#ffbeb5',
      brightGreen: '#b3eed1',
      brightYellow: '#f9e5bc',
      brightBlue: '#afcfff',
      brightMagenta: '#f7c3e5',
      brightCyan: '#b6f1f6',
      brightWhite: '#fff5ee'
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
