import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { HostConfig, IdentityConfig } from '../types/host';
import { tauriInvoke } from './tauri';

export interface SshConnectedResponse {
  sessionId: string;
  ptyBackend: string;
}

export type SshKeyAlgorithm = 'ed25519' | 'rsa4096';

export interface SshGenerateKeypairResponse {
  algorithm: SshKeyAlgorithm;
  privateKey: string;
  publicKey: string;
  fingerprint: string;
}

export interface SshDerivePublicKeyResponse {
  publicKey: string;
  fingerprint: string;
}

export interface SshExportPrivateKeyResponse {
  path: string;
  bytes: number;
}

interface SshConnectRequest {
  sessionId?: string;
  hostConfig: HostConfig;
  identityConfig: IdentityConfig;
  proxyChain: ProxyJumpHop[];
  cols?: number;
  rows?: number;
  term?: string;
}

export interface ProxyJumpHop {
  hostConfig: HostConfig;
  identityConfig: IdentityConfig;
}

export interface SysStatus {
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  netRxBytesPerSec: number;
  netTxBytesPerSec: number;
  sampledAt: number;
  intervalSecs: number;
}

export interface SshSysStatusEvent {
  sessionId: string;
  status: SysStatus;
}

interface SshOutputEvent {
  sessionId: string;
  data: string;
}

const ANSI_PATTERN = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

const normalizePwdOutput = (raw: string): string | null => {
  const cleaned = raw.replace(ANSI_PATTERN, '').replace(/\r/g, '\n');
  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const candidate =
    [...lines].reverse().find((line) => line.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(line)) ??
    lines[lines.length - 1];

  return candidate || null;
};

const toConnectRequest = (
  host: HostConfig,
  identity: IdentityConfig,
  proxyChain: ProxyJumpHop[]
): SshConnectRequest => {
  return {
    hostConfig: host,
    identityConfig: identity,
    proxyChain,
    cols: 120,
    rows: 30,
    term: 'xterm-256color'
  };
};

export const sshConnect = async (
  host: HostConfig,
  identity: IdentityConfig,
  proxyChain: ProxyJumpHop[] = []
): Promise<SshConnectedResponse> => {
  return tauriInvoke<SshConnectedResponse>('ssh_connect', {
    request: toConnectRequest(host, identity, proxyChain)
  });
};

export const sshWrite = async (sessionId: string, data: string): Promise<void> => {
  await tauriInvoke<void>('ssh_write', {
    request: {
      sessionId,
      data
    }
  });
};

export const sshResize = async (
  sessionId: string,
  cols: number,
  rows: number
): Promise<void> => {
  await tauriInvoke<void>('ssh_resize', {
    request: {
      sessionId,
      cols,
      rows
    }
  });
};

export const sshDisconnect = async (sessionId: string): Promise<void> => {
  await tauriInvoke<void>('ssh_disconnect', {
    request: {
      sessionId
    }
  });
};

export const sshSetPulseActivity = async (sessionId: string, active: boolean): Promise<void> => {
  await tauriInvoke<void>('ssh_set_pulse_activity', {
    request: {
      sessionId,
      active
    }
  });
};

export const sshGenerateKeypair = async (
  algorithm: SshKeyAlgorithm,
  comment?: string
): Promise<SshGenerateKeypairResponse> => {
  return tauriInvoke<SshGenerateKeypairResponse>('ssh_generate_keypair', {
    request: {
      algorithm,
      comment: comment?.trim() ? comment.trim() : undefined
    }
  });
};

export const sshDerivePublicKey = async (
  privateKey: string
): Promise<SshDerivePublicKeyResponse> => {
  return tauriInvoke<SshDerivePublicKeyResponse>('ssh_derive_public_key', {
    request: {
      privateKey
    }
  });
};

export const sshDeployPublicKey = async (
  sessionId: string,
  publicKey: string
): Promise<void> => {
  await tauriInvoke<void>('ssh_deploy_public_key', {
    request: {
      sessionId,
      publicKey
    }
  });
};

export const sshExportPrivateKey = async (
  privateKey: string,
  destinationPath: string
): Promise<SshExportPrivateKeyResponse> => {
  return tauriInvoke<SshExportPrivateKeyResponse>('ssh_export_private_key', {
    request: {
      privateKey,
      destinationPath
    }
  });
};

export const sshQueryPwd = async (
  sessionId: string,
  timeoutMs = 3500
): Promise<string> => {
  const marker = String.fromCharCode(0x1d);
  const command = `printf '\\035%s\\035\\n' "$PWD"`;

  return new Promise<string>((resolve, reject) => {
    let done = false;
    let outputBuffer = '';
    let timer = 0;
    let unlisten: UnlistenFn | null = null;

    const finish = (action: () => void): void => {
      if (done) {
        return;
      }
      done = true;
      window.clearTimeout(timer);
      if (unlisten) {
        void unlisten();
      }
      action();
    };

    const tryParse = (): void => {
      const start = outputBuffer.indexOf(marker);
      if (start < 0) {
        if (outputBuffer.length > 4096) {
          outputBuffer = outputBuffer.slice(-2048);
        }
        return;
      }

      const end = outputBuffer.indexOf(marker, start + 1);
      if (end < 0) {
        if (start > 0) {
          outputBuffer = outputBuffer.slice(start);
        }
        return;
      }

      const captured = outputBuffer.slice(start + 1, end);
      const parsedPath = normalizePwdOutput(captured);
      if (!parsedPath) {
        finish(() => reject(new Error('未能识别当前终端路径，请重试。')));
        return;
      }

      finish(() => resolve(parsedPath));
    };

    timer = window.setTimeout(() => {
      finish(() => reject(new Error('路径同步超时，请确认终端会话在线。')));
    }, timeoutMs);

    void listen<SshOutputEvent>('ssh-output', (event) => {
      if (done || event.payload.sessionId !== sessionId) {
        return;
      }
      outputBuffer += event.payload.data;
      tryParse();
    })
      .then((fn) => {
        if (done) {
          fn();
          return;
        }
        unlisten = fn;
        return sshWrite(sessionId, `${command}\n`);
      })
      .catch(() => {
        finish(() => reject(new Error('请求终端路径失败，请稍后重试。')));
      });
  });
};
