import { tauriInvoke } from './tauri';

export interface AiTranslateResponse {
  command: string;
  provider: string;
  riskNotice: string;
}

export interface AiExplainSshErrorResponse {
  provider: string;
  advice: string;
  riskNotice: string;
}

export const aiTranslateCommand = async (text: string): Promise<AiTranslateResponse> => {
  return tauriInvoke<AiTranslateResponse>('ai_translate_command', {
    request: {
      text
    }
  });
};

export const aiExplainSshError = async (
  errorMessage: string,
  logContext: string[]
): Promise<AiExplainSshErrorResponse> => {
  return tauriInvoke<AiExplainSshErrorResponse>('ai_explain_ssh_error', {
    request: {
      errorMessage,
      logContext
    }
  });
};
