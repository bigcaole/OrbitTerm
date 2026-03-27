import { useAppLogStore, type AppLogLevel } from '../store/useAppLogStore';

const normalizeDetail = (detail: unknown): string | undefined => {
  if (detail == null) {
    return undefined;
  }
  if (typeof detail === 'string') {
    return detail;
  }
  if (detail instanceof Error) {
    return detail.stack ?? detail.message;
  }
  try {
    return JSON.stringify(detail);
  } catch (_error) {
    return String(detail);
  }
};

export const appendAppLog = (
  level: AppLogLevel,
  scope: string,
  message: string,
  detail?: unknown
): void => {
  useAppLogStore.getState().appendLog({
    level,
    scope,
    message,
    detail: normalizeDetail(detail)
  });
};

export const logAppInfo = (scope: string, message: string, detail?: unknown): void => {
  appendAppLog('info', scope, message, detail);
};

export const logAppWarn = (scope: string, message: string, detail?: unknown): void => {
  appendAppLog('warn', scope, message, detail);
};

export const logAppError = (scope: string, message: string, detail?: unknown): void => {
  appendAppLog('error', scope, message, detail);
};
