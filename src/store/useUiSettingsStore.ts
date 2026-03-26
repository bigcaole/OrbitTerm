import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { LoyuThemePresetId } from '../theme/loyuTheme';

interface UiSettingsState {
  terminalFontSize: number;
  terminalFontFamily: string;
  terminalOpacity: number;
  terminalBlur: number;
  themePresetId: LoyuThemePresetId;
  autoLockEnabled: boolean;
  autoLockMinutes: number;
  hasCompletedOnboarding: boolean;
  setTerminalFontSize: (value: number) => void;
  setTerminalFontFamily: (value: string) => void;
  setTerminalOpacity: (value: number) => void;
  setTerminalBlur: (value: number) => void;
  setThemePresetId: (value: LoyuThemePresetId) => void;
  setAutoLockEnabled: (value: boolean) => void;
  setAutoLockMinutes: (value: number) => void;
  setHasCompletedOnboarding: (value: boolean) => void;
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export const useUiSettingsStore = create<UiSettingsState>()(
  persist(
    (set) => ({
      terminalFontSize: 14,
      terminalFontFamily:
        'IBM Plex Mono, Source Code Pro, Inconsolata, Sarasa Mono SC, Menlo, Monaco, monospace',
      terminalOpacity: 92,
      terminalBlur: 10,
      themePresetId: 'abyss',
      autoLockEnabled: true,
      autoLockMinutes: 5,
      hasCompletedOnboarding: false,
      setTerminalFontSize: (value) => {
        set({ terminalFontSize: clamp(Math.round(value), 11, 22) });
      },
      setTerminalFontFamily: (value) => {
        const next = value.trim();
        if (!next) {
          return;
        }
        set({ terminalFontFamily: next });
      },
      setTerminalOpacity: (value) => {
        set({ terminalOpacity: clamp(Math.round(value), 50, 100) });
      },
      setTerminalBlur: (value) => {
        set({ terminalBlur: clamp(Math.round(value), 0, 28) });
      },
      setThemePresetId: (value) => {
        set({ themePresetId: value });
      },
      setAutoLockEnabled: (value) => {
        set({ autoLockEnabled: value });
      },
      setAutoLockMinutes: (value) => {
        set({ autoLockMinutes: clamp(Math.round(value), 1, 120) });
      },
      setHasCompletedOnboarding: (value) => {
        set({ hasCompletedOnboarding: value });
      }
    }),
    {
      name: 'loyu-ui-settings-v1',
      storage: createJSONStorage(() => window.localStorage),
      partialize: (state) => ({
        terminalFontSize: state.terminalFontSize,
        terminalFontFamily: state.terminalFontFamily,
        terminalOpacity: state.terminalOpacity,
        terminalBlur: state.terminalBlur,
        themePresetId: state.themePresetId,
        autoLockEnabled: state.autoLockEnabled,
        autoLockMinutes: state.autoLockMinutes,
        hasCompletedOnboarding: state.hasCompletedOnboarding
      })
    }
  )
);
