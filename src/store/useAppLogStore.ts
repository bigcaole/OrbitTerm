import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppLogLevel = 'info' | 'warn' | 'error';

export interface AppLogEntry {
  id: string;
  level: AppLogLevel;
  scope: string;
  message: string;
  detail?: string;
  timestamp: number;
}

interface AppLogState {
  logs: AppLogEntry[];
  appendLog: (entry: Omit<AppLogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
}

const MAX_APP_LOGS = 400;

const createLogId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `log-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

export const useAppLogStore = create<AppLogState>()(
  persist(
    (set) => ({
      logs: [],
      appendLog: (entry) => {
        set((state) => {
          const next: AppLogEntry = {
            ...entry,
            id: createLogId(),
            timestamp: Date.now()
          };
          const combined = [...state.logs, next];
          if (combined.length <= MAX_APP_LOGS) {
            return { logs: combined };
          }
          return { logs: combined.slice(combined.length - MAX_APP_LOGS) };
        });
      },
      clearLogs: () => {
        set({ logs: [] });
      }
    }),
    {
      name: 'orbitterm-app-logs-v1',
      partialize: (state) => ({
        logs: state.logs
      })
    }
  )
);
