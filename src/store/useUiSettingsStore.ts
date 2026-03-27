import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { OrbitThemePresetId } from '../theme/orbitTheme';

interface UiSettingsState {
  terminalFontSize: number;
  terminalFontFamily: string;
  terminalOpacity: number;
  terminalBlur: number;
  acrylicBlur: number;
  acrylicSaturation: number;
  acrylicBrightness: number;
  themePresetId: OrbitThemePresetId;
  autoLockEnabled: boolean;
  autoLockMinutes: number;
  hasCompletedOnboarding: boolean;
  hostUsageStats: Record<string, { count: number; lastConnectedAt: number }>;
  setTerminalFontSize: (value: number) => void;
  setTerminalFontFamily: (value: string) => void;
  setTerminalOpacity: (value: number) => void;
  setTerminalBlur: (value: number) => void;
  setAcrylicBlur: (value: number) => void;
  setAcrylicSaturation: (value: number) => void;
  setAcrylicBrightness: (value: number) => void;
  setThemePresetId: (value: OrbitThemePresetId) => void;
  setAutoLockEnabled: (value: boolean) => void;
  setAutoLockMinutes: (value: number) => void;
  setHasCompletedOnboarding: (value: boolean) => void;
  recordHostConnection: (hostId: string) => void;
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export const useUiSettingsStore = create<UiSettingsState>()(
  persist(
    (set) => ({
      terminalFontSize: 14,
      terminalFontFamily:
        '"IBM Plex Mono", "Symbols Nerd Font Mono", "Nerd Font Symbols", "JetBrainsMono Nerd Font", "JetBrains Mono", "Source Code Pro", Inconsolata, "Sarasa Mono SC", Menlo, Monaco, monospace',
      terminalOpacity: 92,
      terminalBlur: 10,
      acrylicBlur: 18,
      acrylicSaturation: 128,
      acrylicBrightness: 104,
      themePresetId: 'abyss',
      autoLockEnabled: true,
      autoLockMinutes: 5,
      hasCompletedOnboarding: false,
      hostUsageStats: {},
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
      setAcrylicBlur: (value) => {
        set({ acrylicBlur: clamp(Math.round(value), 0, 48) });
      },
      setAcrylicSaturation: (value) => {
        set({ acrylicSaturation: clamp(Math.round(value), 60, 220) });
      },
      setAcrylicBrightness: (value) => {
        set({ acrylicBrightness: clamp(Math.round(value), 70, 150) });
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
      },
      recordHostConnection: (hostId) => {
        const normalized = hostId.trim();
        if (!normalized) {
          return;
        }
        set((state) => {
          const prev = state.hostUsageStats[normalized];
          const nextCount = (prev?.count ?? 0) + 1;
          return {
            hostUsageStats: {
              ...state.hostUsageStats,
              [normalized]: {
                count: nextCount,
                lastConnectedAt: Date.now()
              }
            }
          };
        });
      }
    }),
    {
      name: 'orbitterm-ui-settings-v1',
      storage: createJSONStorage(() => window.localStorage),
      partialize: (state) => ({
        terminalFontSize: state.terminalFontSize,
        terminalFontFamily: state.terminalFontFamily,
        terminalOpacity: state.terminalOpacity,
        terminalBlur: state.terminalBlur,
        acrylicBlur: state.acrylicBlur,
        acrylicSaturation: state.acrylicSaturation,
        acrylicBrightness: state.acrylicBrightness,
        themePresetId: state.themePresetId,
        autoLockEnabled: state.autoLockEnabled,
        autoLockMinutes: state.autoLockMinutes,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        hostUsageStats: state.hostUsageStats
      })
    }
  )
);
