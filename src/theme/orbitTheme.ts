import type { ITheme } from 'xterm';

export type OrbitThemePresetId =
  | 'abyss'
  | 'solarized_dark'
  | 'solarized_light'
  | 'monokai'
  | 'dracula'
  | 'one_half_dark'
  | 'nord'
  | 'gruvbox_dark'
  | 'tokyo_night'
  | 'catppuccin_mocha';

export interface OrbitThemePreset {
  id: OrbitThemePresetId;
  name: string;
  description: string;
  bodyBackground: string;
  terminalSurfaceHex: string;
  terminalBorder: string;
  terminalTheme: ITheme;
}

const ABYSS_THEME: OrbitThemePreset = {
  id: 'abyss',
  name: 'Abyss Cyber',
  description: '轨连默认：深邃蓝与赛博高亮平衡。',
  bodyBackground:
    'radial-gradient(circle at 10% 16%, rgba(88, 166, 255, 0.48), transparent 34%), radial-gradient(circle at 84% 12%, rgba(48, 120, 220, 0.38), transparent 32%), radial-gradient(circle at 52% 86%, rgba(126, 198, 255, 0.48), transparent 42%), linear-gradient(135deg, #dce9ff 0%, #c9ddff 50%, #ecf4ff 100%)',
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

export const ORBIT_THEME_PRESETS: ReadonlyArray<OrbitThemePreset> = [
  ABYSS_THEME,
  {
    id: 'solarized_dark',
    name: 'Solarized Dark',
    description: '经典护眼暗色，低对比但可读性高。',
    bodyBackground:
      'radial-gradient(circle at 14% 18%, rgba(88, 110, 117, 0.35), transparent 36%), radial-gradient(circle at 84% 16%, rgba(7, 54, 66, 0.45), transparent 34%), linear-gradient(130deg, #dce4e7 0%, #ced9de 46%, #eef3f5 100%)',
    terminalSurfaceHex: '#002b36',
    terminalBorder: '#1f535f',
    terminalTheme: {
      background: '#002b36',
      foreground: '#93a1a1',
      cursor: '#93a1a1',
      selectionBackground: '#33545f7f',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    }
  },
  {
    id: 'solarized_light',
    name: 'Solarized Light',
    description: '经典浅色方案，适合白天办公。',
    bodyBackground:
      'radial-gradient(circle at 18% 15%, rgba(253, 246, 227, 0.85), transparent 42%), radial-gradient(circle at 82% 16%, rgba(238, 232, 213, 0.75), transparent 38%), linear-gradient(130deg, #f7f2df 0%, #f0ead2 52%, #fffaf0 100%)',
    terminalSurfaceHex: '#fdf6e3',
    terminalBorder: '#d4c8a2',
    terminalTheme: {
      background: '#fdf6e3',
      foreground: '#657b83',
      cursor: '#586e75',
      selectionBackground: '#d9d0b188',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#002b36'
    }
  },
  {
    id: 'monokai',
    name: 'Monokai Pro',
    description: '高饱和经典编程配色，语义分明。',
    bodyBackground:
      'radial-gradient(circle at 15% 20%, rgba(247, 120, 107, 0.34), transparent 34%), radial-gradient(circle at 82% 18%, rgba(166, 226, 46, 0.28), transparent 36%), linear-gradient(132deg, #d8dbe2 0%, #cfd5de 46%, #eceff5 100%)',
    terminalSurfaceHex: '#272822',
    terminalBorder: '#4d4f45',
    terminalTheme: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      selectionBackground: '#49483e99',
      black: '#272822',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#f4bf75',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#2aa198',
      white: '#f8f8f2',
      brightBlack: '#75715e',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#f4bf75',
      brightBlue: '#66d9ef',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#f9f8f5'
    }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    description: '紫系名作，夜间视觉舒适。',
    bodyBackground:
      'radial-gradient(circle at 14% 16%, rgba(189, 147, 249, 0.36), transparent 34%), radial-gradient(circle at 86% 14%, rgba(139, 233, 253, 0.28), transparent 34%), linear-gradient(132deg, #ddd9ef 0%, #d3cfee 52%, #f1eefb 100%)',
    terminalSurfaceHex: '#282a36',
    terminalBorder: '#44475a',
    terminalTheme: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: '#44475a99',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
    }
  },
  {
    id: 'one_half_dark',
    name: 'One Half Dark',
    description: 'VS Code 系列经典暗色，清爽克制。',
    bodyBackground:
      'radial-gradient(circle at 14% 20%, rgba(97, 175, 239, 0.33), transparent 34%), radial-gradient(circle at 82% 20%, rgba(152, 195, 121, 0.28), transparent 35%), linear-gradient(132deg, #dde3ee 0%, #d3dcea 48%, #eff3f9 100%)',
    terminalSurfaceHex: '#282c34',
    terminalBorder: '#3e4451',
    terminalTheme: {
      background: '#282c34',
      foreground: '#dcdfe4',
      cursor: '#528bff',
      selectionBackground: '#3e44518a',
      black: '#282c34',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#dcdfe4',
      brightBlack: '#5a6374',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff'
    }
  },
  {
    id: 'nord',
    name: 'Nord',
    description: '冷调北欧风格，长时间阅读友好。',
    bodyBackground:
      'radial-gradient(circle at 14% 16%, rgba(136, 192, 208, 0.36), transparent 34%), radial-gradient(circle at 82% 16%, rgba(129, 161, 193, 0.32), transparent 34%), linear-gradient(133deg, #dfe6ef 0%, #d6e0eb 50%, #eef3f9 100%)',
    terminalSurfaceHex: '#2e3440',
    terminalBorder: '#4c566a',
    terminalTheme: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#88c0d0',
      selectionBackground: '#434c5e88',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4'
    }
  },
  {
    id: 'gruvbox_dark',
    name: 'Gruvbox Dark',
    description: '暖调复古，低蓝光风格更护眼。',
    bodyBackground:
      'radial-gradient(circle at 12% 18%, rgba(215, 153, 33, 0.35), transparent 35%), radial-gradient(circle at 82% 16%, rgba(184, 187, 38, 0.3), transparent 34%), linear-gradient(132deg, #e7ded0 0%, #ddd3c2 50%, #f2ebe2 100%)',
    terminalSurfaceHex: '#282828',
    terminalBorder: '#665c54',
    terminalTheme: {
      background: '#282828',
      foreground: '#ebdbb2',
      cursor: '#ebdbb2',
      selectionBackground: '#665c5488',
      black: '#282828',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#a89984',
      brightBlack: '#928374',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2'
    }
  },
  {
    id: 'tokyo_night',
    name: 'Tokyo Night',
    description: '高对比霓虹蓝，赛博朋克氛围强。',
    bodyBackground:
      'radial-gradient(circle at 14% 16%, rgba(122, 162, 247, 0.35), transparent 34%), radial-gradient(circle at 84% 14%, rgba(187, 154, 247, 0.28), transparent 35%), linear-gradient(132deg, #d9ddf3 0%, #d1d5ee 52%, #edf0fc 100%)',
    terminalSurfaceHex: '#1a1b26',
    terminalBorder: '#3b4261',
    terminalTheme: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor: '#7aa2f7',
      selectionBackground: '#33467c85',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5'
    }
  },
  {
    id: 'catppuccin_mocha',
    name: 'Catppuccin Mocha',
    description: '奶油高亮 + 深色背景，观感细腻。',
    bodyBackground:
      'radial-gradient(circle at 12% 16%, rgba(203, 166, 247, 0.32), transparent 34%), radial-gradient(circle at 82% 14%, rgba(137, 220, 235, 0.26), transparent 34%), linear-gradient(132deg, #e2dff0 0%, #d8d5ea 50%, #f1eef8 100%)',
    terminalSurfaceHex: '#1e1e2e',
    terminalBorder: '#45475a',
    terminalTheme: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      selectionBackground: '#585b7088',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#cba6f7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#cba6f7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8'
    }
  }
];

export const resolveThemePreset = (id: OrbitThemePresetId): OrbitThemePreset => {
  return ORBIT_THEME_PRESETS.find((preset) => preset.id === id) ?? ABYSS_THEME;
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
