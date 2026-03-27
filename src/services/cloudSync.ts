const CLOUD_SYNC_SESSION_KEY = 'orbitterm:cloud-sync-session:v1';
const REQUEST_TIMEOUT_MS = 12_000;

export interface CloudSyncSession {
  apiBaseUrl: string;
  email: string;
  token: string;
  currentDeviceId?: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
  };
  currentDeviceId: string;
}

export interface SyncPushRequest {
  version: number;
  encryptedBlobBase64: string;
}

export interface SyncPushResponse {
  acceptedVersion: number;
  updatedAt: string;
}

export interface SyncPullResponse {
  hasData: boolean;
  version?: number;
  encryptedBlobBase64?: string;
  updatedAt?: string;
}

export interface SyncStatusResponse {
  hasData: boolean;
  version: number;
  updatedAt?: string;
}

export interface CloudDeviceItem {
  id: string;
  deviceName: string;
  deviceLocation: string;
  userAgent: string;
  lastSeenAt: string;
  createdAt: string;
  isCurrent: boolean;
}

interface CloudDevicesResponse {
  devices: CloudDeviceItem[];
}

interface LogoutDeviceResponse {
  revokedCount: number;
  message: string;
}

export class CloudSyncConflictError extends Error {
  latest: SyncPullResponse | null;

  constructor(message: string, latest: SyncPullResponse | null) {
    super(message);
    this.name = 'CloudSyncConflictError';
    this.latest = latest;
  }
}

const ensureHttpsEndpoint = (apiBaseUrl: string): string => {
  const normalized = apiBaseUrl.trim().replace(/\/+$/, '');
  if (!normalized) {
    throw new Error('同步服务地址不能为空。');
  }
  if (!normalized.startsWith('https://')) {
    throw new Error('同步服务必须使用 HTTPS 地址。');
  }
  return normalized;
};

const withTimeout = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('云同步请求超时，请检查网络后重试。');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutHandle);
  }
};

const readJson = async <T>(response: Response, fallbackMessage: string): Promise<T> => {
  if (!response.ok) {
    let detail = fallbackMessage;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        detail = payload.message;
      }
    } catch (_error) {
      // Ignore parse errors.
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
};

const saveSession = (session: CloudSyncSession): void => {
  window.localStorage.setItem(CLOUD_SYNC_SESSION_KEY, JSON.stringify(session));
};

const detectDeviceName = (): string => {
  const platform = (window.navigator.platform || '').toLowerCase();
  if (platform.includes('mac')) {
    return 'Mac 设备';
  }
  if (platform.includes('win')) {
    return 'Windows 设备';
  }
  if (platform.includes('linux')) {
    return 'Linux 设备';
  }
  return 'OrbitTerm 设备';
};

const detectDeviceLocation = (): string => {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timezone) {
    return '未知地区';
  }
  const city = timezone.split('/').pop();
  if (!city) {
    return timezone;
  }
  return city.replace(/_/g, ' ');
};

export const readCloudSyncSession = (): CloudSyncSession | null => {
  const raw = window.localStorage.getItem(CLOUD_SYNC_SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CloudSyncSession>;
    if (!parsed.apiBaseUrl || !parsed.email || !parsed.token) {
      return null;
    }
    return {
      apiBaseUrl: parsed.apiBaseUrl,
      email: parsed.email,
      token: parsed.token,
      currentDeviceId:
        typeof parsed.currentDeviceId === 'string' ? parsed.currentDeviceId : undefined
    };
  } catch (_error) {
    return null;
  }
};

export const clearCloudSyncSession = (): void => {
  window.localStorage.removeItem(CLOUD_SYNC_SESSION_KEY);
};

export const registerCloudSync = async (
  apiBaseUrl: string,
  email: string,
  password: string
): Promise<CloudSyncSession> => {
  const endpoint = ensureHttpsEndpoint(apiBaseUrl);
  const response = await withTimeout(`${endpoint}/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password,
      deviceName: detectDeviceName(),
      deviceLocation: detectDeviceLocation()
    })
  });
  const payload = await readJson<AuthResponse>(response, '注册失败，请稍后重试。');
  const session: CloudSyncSession = {
    apiBaseUrl: endpoint,
    email: payload.user.email,
    token: payload.token,
    currentDeviceId: payload.currentDeviceId
  };
  saveSession(session);
  return session;
};

export const loginCloudSync = async (
  apiBaseUrl: string,
  email: string,
  password: string
): Promise<CloudSyncSession> => {
  const endpoint = ensureHttpsEndpoint(apiBaseUrl);
  const response = await withTimeout(`${endpoint}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password,
      deviceName: detectDeviceName(),
      deviceLocation: detectDeviceLocation()
    })
  });
  const payload = await readJson<AuthResponse>(response, '登录失败，请检查账号或密码。');
  const session: CloudSyncSession = {
    apiBaseUrl: endpoint,
    email: payload.user.email,
    token: payload.token,
    currentDeviceId: payload.currentDeviceId
  };
  saveSession(session);
  return session;
};

const authHeaders = (token: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`
});

export const pushCloudSyncBlob = async (
  session: CloudSyncSession,
  request: SyncPushRequest
): Promise<SyncPushResponse> => {
  const endpoint = ensureHttpsEndpoint(session.apiBaseUrl);
  const response = await withTimeout(`${endpoint}/sync/push`, {
    method: 'POST',
    headers: authHeaders(session.token),
    body: JSON.stringify(request)
  });
  if (response.status === 409) {
    let message = '检测到版本冲突，请先拉取最新数据后重试。';
    let latest: SyncPullResponse | null = null;
    try {
      const payload = (await response.json()) as { message?: string; latest?: SyncPullResponse };
      if (payload.message) {
        message = payload.message;
      }
      if (payload.latest) {
        latest = payload.latest;
      }
    } catch (_error) {
      // Ignore parse errors and use fallback.
    }
    throw new CloudSyncConflictError(message, latest);
  }
  return readJson<SyncPushResponse>(response, '同步上传失败，请稍后重试。');
};

export const getCloudSyncStatus = async (session: CloudSyncSession): Promise<SyncStatusResponse> => {
  const endpoint = ensureHttpsEndpoint(session.apiBaseUrl);
  const response = await withTimeout(`${endpoint}/sync/status`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  return readJson<SyncStatusResponse>(response, '获取同步状态失败，请稍后重试。');
};

export const pullCloudSyncBlob = async (session: CloudSyncSession): Promise<SyncPullResponse> => {
  const endpoint = ensureHttpsEndpoint(session.apiBaseUrl);
  const response = await withTimeout(`${endpoint}/sync/pull`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  return readJson<SyncPullResponse>(response, '同步拉取失败，请稍后重试。');
};

export const listCloudDevices = async (session: CloudSyncSession): Promise<CloudDeviceItem[]> => {
  const endpoint = ensureHttpsEndpoint(session.apiBaseUrl);
  const response = await withTimeout(`${endpoint}/devices`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const payload = await readJson<CloudDevicesResponse>(response, '获取设备列表失败，请稍后重试。');
  return payload.devices;
};

export const logoutCloudDevice = async (
  session: CloudSyncSession,
  deviceId: string
): Promise<LogoutDeviceResponse> => {
  const endpoint = ensureHttpsEndpoint(session.apiBaseUrl);
  const response = await withTimeout(`${endpoint}/logout/device`, {
    method: 'POST',
    headers: authHeaders(session.token),
    body: JSON.stringify({
      deviceId
    })
  });
  return readJson<LogoutDeviceResponse>(response, '退出设备失败，请稍后重试。');
};

export const logoutAllCloudDevices = async (
  session: CloudSyncSession
): Promise<LogoutDeviceResponse> => {
  const endpoint = ensureHttpsEndpoint(session.apiBaseUrl);
  const response = await withTimeout(`${endpoint}/logout/device`, {
    method: 'POST',
    headers: authHeaders(session.token),
    body: JSON.stringify({
      revokeAll: true
    })
  });
  return readJson<LogoutDeviceResponse>(response, '退出所有设备失败，请稍后重试。');
};
