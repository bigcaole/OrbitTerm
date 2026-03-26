import { tauriInvoke } from './tauri';

export interface SshDiagnosticLogEvent {
  sessionId: string;
  level: 'info' | 'warn' | 'error' | string;
  stage: string;
  message: string;
  timestamp: number;
}

export interface HealthCheckItem {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error' | string;
  message: string;
  suggestion?: string;
}

export interface HealthCheckResponse {
  generatedAt: number;
  items: HealthCheckItem[];
}

export const runHealthCheck = async (): Promise<HealthCheckResponse> => {
  return tauriInvoke<HealthCheckResponse>('run_health_check');
};
