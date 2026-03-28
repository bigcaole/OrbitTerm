import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { OrbitThemePresetId } from '../theme/orbitTheme';

export type CloseWindowAction = 'ask' | 'tray' | 'exit';

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
  closeWindowAction: CloseWindowAction;
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
  setCloseWindowAction: (value: CloseWindowAction) => void;
  setHasCompletedOnboarding: (value: boolean) => void;
  recordHostConnection: (hostId: string) => void;
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const fallbackStorage = new Map<string, string>();

const safeStateStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch (_error) {
      return fallbackStorage.get(name) ?? null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch (_error) {
      fallbackStorage.set(name, value);
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch (_error) {
      fallbackStorage.delete(name);
    }
  }
};

const normalizeHostUsageStats = (value: unknown): Record<string, { count: number; lastConnectedAt: number }> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const source = value as Record<string, unknown>;
  const next: Record<string, { count: number; lastConnectedAt: number }> = {};
  for (const [key, rawItem] of Object.entries(source)) {
    if (!key.trim() || !rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      continue;
    }
    const item = rawItem as Record<string, unknown>;
    const rawCount = typeof item.count === 'number' ? item.count : Number(item.count);
    const rawLastConnectedAt =
      typeof item.lastConnectedAt === 'number' ? item.lastConnectedAt : Number(item.lastConnectedAt);
    if (!Number.isFinite(rawCount) || !Number.isFinite(rawLastConnectedAt)) {
      continue;
    }
    next[key] = {
      count: Math.max(0, Math.round(rawCount)),
      lastConnectedAt: Math.max(0, Math.round(rawLastConnectedAt))
    };
  }
  return next;
};

const normalizeCloseWindowAction = (
  value: unknown,
  fallback: CloseWindowAction
): CloseWindowAction => {
  if (value === 'ask' || value === 'tray' || value === 'exit') {
    return value;
  }
  return fallback;
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
      closeWindowAction: 'ask',
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
      setCloseWindowAction: (value) => {
        set({ closeWindowAction: normalizeCloseWindowAction(value, 'ask') });
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
      storage: createJSONStorage(() => safeStateStorage),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<UiSettingsState>;
        const nextThemePreset =
          typeof persisted.themePresetId === 'string'
            ? (persisted.themePresetId as OrbitThemePresetId)
            : currentState.themePresetId;

        return {
          ...currentState,
          terminalFontSize:
            typeof persisted.terminalFontSize === 'number'
              ? clamp(Math.round(persisted.terminalFontSize), 11, 22)
              : currentState.terminalFontSize,
          terminalFontFamily:
            typeof persisted.terminalFontFamily === 'string' && persisted.terminalFontFamily.trim()
              ? persisted.terminalFontFamily
              : currentState.terminalFontFamily,
          terminalOpacity:
            typeof persisted.terminalOpacity === 'number'
              ? clamp(Math.round(persisted.terminalOpacity), 50, 100)
              : currentState.terminalOpacity,
          terminalBlur:
            typeof persisted.terminalBlur === 'number'
              ? clamp(Math.round(persisted.terminalBlur), 0, 28)
              : currentState.terminalBlur,
          acrylicBlur:
            typeof persisted.acrylicBlur === 'number'
              ? clamp(Math.round(persisted.acrylicBlur), 0, 48)
              : currentState.acrylicBlur,
          acrylicSaturation:
            typeof persisted.acrylicSaturation === 'number'
              ? clamp(Math.round(persisted.acrylicSaturation), 60, 220)
              : currentState.acrylicSaturation,
          acrylicBrightness:
            typeof persisted.acrylicBrightness === 'number'
              ? clamp(Math.round(persisted.acrylicBrightness), 70, 150)
              : currentState.acrylicBrightness,
          themePresetId: nextThemePreset,
          autoLockEnabled:
            typeof persisted.autoLockEnabled === 'boolean'
              ? persisted.autoLockEnabled
              : currentState.autoLockEnabled,
          autoLockMinutes:
            typeof persisted.autoLockMinutes === 'number'
              ? clamp(Math.round(persisted.autoLockMinutes), 1, 120)
              : currentState.autoLockMinutes,
          closeWindowAction: normalizeCloseWindowAction(
            persisted.closeWindowAction,
            currentState.closeWindowAction
          ),
          hasCompletedOnboarding:
            typeof persisted.hasCompletedOnboarding === 'boolean'
              ? persisted.hasCompletedOnboarding
              : currentState.hasCompletedOnboarding,
          hostUsageStats: normalizeHostUsageStats(persisted.hostUsageStats)
        };
      },
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
        closeWindowAction: state.closeWindowAction,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        hostUsageStats: state.hostUsageStats
      })
    }
  )
);
