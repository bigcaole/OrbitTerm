import { logAppError, logAppInfo, logAppWarn } from './appLog';
const CLOUD_SYNC_SESSION_KEY = 'orbitterm:cloud-sync-session:v1';
const CLOUD_SYNC_CURSOR_KEY = 'orbitterm:cloud-sync-cursor:v1';
const CLOUD_SYNC_POLICY_KEY = 'orbitterm:cloud-sync-policy:v1';
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
  traceId?: string;
  idempotencyReused?: boolean;
}

export interface SyncPullResponse {
  hasData: boolean;
  version?: number;
  encryptedBlobBase64?: string;
  updatedAt?: string;
  traceId?: string;
}

export interface SyncStatusResponse {
  hasData: boolean;
  version: number;
  updatedAt?: string;
  traceId?: string;
}

export interface CloudSyncCursor {
  version: number;
  updatedAt: string | null;
}

export interface CloudSyncPolicy {
  defaultSyncDomain: string;
  lockSyncDomain: boolean;
  hideSyncDomainInput: boolean;
  requireActivation: boolean;
  setupRequired: boolean;
}

export interface CloudLicenseStatus {
  active: boolean;
  planKey?: string;
  isLifetime: boolean;
  expiresAt?: string;
  remainingDays?: number;
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

interface CloudErrorPayload {
  message?: string;
  code?: string;
  traceId?: string;
  trace_id?: string;
  retryable?: boolean;
}

interface CloudDevicesResponse {
  devices: CloudDeviceItem[];
}

interface LogoutDeviceResponse {
  revokedCount: number;
  message: string;
}

interface LicenseActivateResponse {
  message: string;
  status: CloudLicenseStatus;
}

export class CloudSyncConflictError extends Error {
  latest: SyncPullResponse | null;
  code?: string;
  traceId?: string;
  retryable: boolean;

  constructor(
    message: string,
    latest: SyncPullResponse | null,
    options?: {
      code?: string;
      traceId?: string;
      retryable?: boolean;
    }
  ) {
    super(message);
    this.name = 'CloudSyncConflictError';
    this.latest = latest;
    this.code = options?.code;
    this.traceId = options?.traceId;
    this.retryable = options?.retryable === true;
  }
}

export class CloudSyncRequestError extends Error {
  status: number;
  code?: string;
  traceId?: string;
  retryable: boolean;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      traceId?: string;
      retryable?: boolean;
    }
  ) {
    super(message);
    this.name = 'CloudSyncRequestError';
    this.status = options.status;
    this.code = options.code;
    this.traceId = options.traceId;
    this.retryable = options.retryable === true;
  }
}

const ensureHttpsEndpoint = (apiBaseUrl: string): string => {
  const normalized = apiBaseUrl.trim().replace(/\/+$/, '');
  if (!normalized) {
    logAppWarn('cloud-sync', '同步服务地址为空');
    throw new Error('同步服务地址不能为空。');
  }
  if (!normalized.startsWith('https://')) {
    logAppWarn('cloud-sync', '同步服务地址非 HTTPS', normalized);
    throw new Error('同步服务必须使用 HTTPS 地址。');
  }
  return normalized;
};

const RETRY_BACKOFF_MS = [450, 1100];

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const randomJitter = (): number => {
  return Math.floor(Math.random() * 120);
};

const readTraceIdFromHeaders = (response: Response): string | undefined => {
  const direct = response.headers.get('x-trace-id');
  if (!direct) {
    return undefined;
  }
  const trimmed = direct.trim();
  return trimmed || undefined;
};

const parseErrorPayload = async (
  response: Response,
  fallbackMessage: string
): Promise<{
  message: string;
  code?: string;
  traceId?: string;
  retryable: boolean;
  latest?: unknown;
}> => {
  let payload: (CloudErrorPayload & { latest?: unknown }) | null = null;
  try {
    payload = (await response.json()) as CloudErrorPayload & { latest?: unknown };
  } catch (_error) {
    payload = null;
  }
  const message = payload?.message?.trim() || fallbackMessage;
  const code = payload?.code?.trim();
  const traceIdFromPayload = payload?.traceId?.trim() || payload?.trace_id?.trim();
  const traceId = traceIdFromPayload || readTraceIdFromHeaders(response);
  const retryableByStatus = response.status === 429 || response.status >= 500;
  return {
    message,
    code: code || undefined,
    traceId: traceId || undefined,
    retryable: payload?.retryable === true || retryableByStatus,
    latest: payload?.latest
  };
};

const shouldRetryCloudError = (error: unknown): boolean => {
  if (error instanceof CloudSyncConflictError) {
    return false;
  }
  if (error instanceof CloudSyncRequestError) {
    return error.retryable || error.status === 429 || error.status >= 500;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof TypeError) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  if (lowered.includes('network') || lowered.includes('failed to fetch')) {
    return true;
  }
  if (lowered.includes('timeout') || lowered.includes('超时')) {
    return true;
  }
  return false;
};

const withRetry = async <T>(
  scope: string,
  action: (attempt: number) => Promise<T>,
  maxAttempts = 3
): Promise<T> => {
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await action(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetryCloudError(error)) {
        throw error;
      }
      const delayBase =
        RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)] ??
        RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] ??
        1000;
      const delay = delayBase + randomJitter();
      logAppWarn('cloud-sync', '云同步请求将自动重试', {
        scope,
        attempt,
        maxAttempts,
        delay,
        error: error instanceof Error ? error.message : String(error)
      });
      await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('云同步请求失败。');
};

const createIdempotencyKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `idem-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 12)}`;
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
      logAppWarn('cloud-sync', '云同步请求超时', String(input));
      throw new Error('云同步请求超时，请检查网络后重试。');
    }
    logAppError('cloud-sync', '云同步请求失败', {
      input: String(input),
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    window.clearTimeout(timeoutHandle);
  }
};

const readJson = async <T>(response: Response, fallbackMessage: string): Promise<T> => {
  if (!response.ok) {
    const payload = await parseErrorPayload(response, fallbackMessage);
    logAppWarn('cloud-sync', `云同步请求返回异常状态 ${response.status}`, {
      url: response.url,
      message: payload.message,
      code: payload.code,
      traceId: payload.traceId
    });
    throw new CloudSyncRequestError(payload.message, {
      status: response.status,
      code: payload.code,
      traceId: payload.traceId,
      retryable: payload.retryable
    });
  }

  return (await response.json()) as T;
};

const parseSyncVersion = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return fallback;
};

const readString = (raw: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return undefined;
};

const readBoolean = (raw: Record<string, unknown>, keys: string[]): boolean | null => {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }
  }
  return null;
};

const readVersion = (raw: Record<string, unknown>, fallback = 0): number => {
  const candidates = [raw.version, raw.syncVersion, raw.sync_version];
  for (const candidate of candidates) {
    const parsed = parseSyncVersion(candidate, -1);
    if (parsed >= 0) {
      return parsed;
    }
  }
  return fallback;
};

const normalizeSyncPullResponse = (payload: unknown): SyncPullResponse => {
  if (!payload || typeof payload !== 'object') {
    return { hasData: false };
  }
  const raw = payload as Record<string, unknown>;
  const encryptedBlobBase64 = readString(raw, [
    'encryptedBlobBase64',
    'encrypted_blob_base64',
    'encryptedBlob',
    'encrypted_blob',
    'blob'
  ]);
  const hasDataFlag = readBoolean(raw, ['hasData', 'has_data']);
  const hasData = hasDataFlag === null ? Boolean(encryptedBlobBase64) : hasDataFlag;
  const version = readVersion(raw, 0);
  const updatedAt = readString(raw, ['updatedAt', 'updated_at']);
  const traceId = readString(raw, ['traceId', 'trace_id']);
  if (!hasData) {
    return {
      hasData: false,
      version,
      updatedAt,
      traceId
    };
  }
  return {
    hasData: true,
    version,
    encryptedBlobBase64,
    updatedAt,
    traceId
  };
};

const normalizeSyncStatusResponse = (payload: unknown): SyncStatusResponse => {
  if (!payload || typeof payload !== 'object') {
    return {
      hasData: false,
      version: 0
    };
  }
  const raw = payload as Record<string, unknown>;
  const hasDataFlag = readBoolean(raw, ['hasData', 'has_data']);
  const hasData = hasDataFlag === null ? readVersion(raw, 0) > 0 : hasDataFlag;
  return {
    hasData,
    version: readVersion(raw, 0),
    updatedAt: readString(raw, ['updatedAt', 'updated_at']),
    traceId: readString(raw, ['traceId', 'trace_id'])
  };
};

const normalizeSyncPushResponse = (payload: unknown): SyncPushResponse => {
  if (!payload || typeof payload !== 'object') {
    return {
      acceptedVersion: 0,
      updatedAt: ''
    };
  }
  const raw = payload as Record<string, unknown>;
  const acceptedVersion = parseSyncVersion(
    raw.acceptedVersion ?? raw.accepted_version ?? raw.version,
    0
  );
  return {
    acceptedVersion,
    updatedAt: readString(raw, ['updatedAt', 'updated_at']) ?? '',
    traceId: readString(raw, ['traceId', 'trace_id']),
    idempotencyReused: readBoolean(raw, ['idempotencyReused', 'idempotency_reused']) === true
  };
};

const saveSession = (session: CloudSyncSession): void => {
  window.localStorage.setItem(CLOUD_SYNC_SESSION_KEY, JSON.stringify(session));
};

const saveCloudSyncPolicy = (policy: CloudSyncPolicy): void => {
  window.localStorage.setItem(CLOUD_SYNC_POLICY_KEY, JSON.stringify(policy));
};

export const readCloudSyncPolicy = (): CloudSyncPolicy | null => {
  const raw = window.localStorage.getItem(CLOUD_SYNC_POLICY_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CloudSyncPolicy>;
    return {
      defaultSyncDomain: typeof parsed.defaultSyncDomain === 'string' ? parsed.defaultSyncDomain : '',
      lockSyncDomain: parsed.lockSyncDomain === true,
      hideSyncDomainInput: parsed.hideSyncDomainInput === true,
      requireActivation: parsed.requireActivation !== false,
      setupRequired: parsed.setupRequired === true
    };
  } catch (_error) {
    return null;
  }
};

const normalizeSyncIdentity = (apiBaseUrl: string, email: string): string => {
  return `${apiBaseUrl.trim().replace(/\/+$/, '').toLowerCase()}|${email.trim().toLowerCase()}`;
};

const readCursorStore = (): Record<string, CloudSyncCursor> => {
  const raw = window.localStorage.getItem(CLOUD_SYNC_CURSOR_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const next: Record<string, CloudSyncCursor> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!key || !value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      const item = value as Record<string, unknown>;
      const version = parseSyncVersion(item.version, -1);
      if (version < 0) {
        continue;
      }
      const updatedAt = typeof item.updatedAt === 'string' ? item.updatedAt : null;
      next[key] = {
        version,
        updatedAt
      };
    }
    return next;
  } catch (_error) {
    return {};
  }
};

const writeCursorStore = (payload: Record<string, CloudSyncCursor>): void => {
  window.localStorage.setItem(CLOUD_SYNC_CURSOR_KEY, JSON.stringify(payload));
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

export const clearCloudSyncPolicy = (): void => {
  window.localStorage.removeItem(CLOUD_SYNC_POLICY_KEY);
};

export const readCloudSyncCursor = (session: CloudSyncSession): CloudSyncCursor | null => {
  const key = normalizeSyncIdentity(session.apiBaseUrl, session.email);
  const store = readCursorStore();
  return store[key] ?? null;
};

export const writeCloudSyncCursor = (
  session: CloudSyncSession,
  cursor: CloudSyncCursor
): void => {
  const key = normalizeSyncIdentity(session.apiBaseUrl, session.email);
  const store = readCursorStore();
  store[key] = {
    version: parseSyncVersion(cursor.version, 0),
    updatedAt: cursor.updatedAt ?? null
  };
  writeCursorStore(store);
};

export const registerCloudSync = async (
  apiBaseUrl: string,
  email: string,
  password: string
): Promise<CloudSyncSession> => {
  const endpoint = ensureHttpsEndpoint(apiBaseUrl);
  try {
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
    try {
      const policy = await fetchCloudSyncPolicy(endpoint);
      saveCloudSyncPolicy(policy);
    } catch (_error) {
      // Ignore policy fetch failures and keep flow.
    }
    logAppInfo('cloud-sync', '注册同步账号成功', {
      endpoint,
      email: payload.user.email
    });
    return session;
  } catch (error) {
    logAppError('cloud-sync', '注册同步账号失败', {
      endpoint,
      email,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

export const loginCloudSync = async (
  apiBaseUrl: string,
  email: string,
  password: string
): Promise<CloudSyncSession> => {
  const endpoint = ensureHttpsEndpoint(apiBaseUrl);
  try {
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
    try {
      const policy = await fetchCloudSyncPolicy(endpoint);
      saveCloudSyncPolicy(policy);
    } catch (_error) {
      // Ignore policy fetch failures and keep flow.
    }
    logAppInfo('cloud-sync', '登录同步账号成功', {
      endpoint,
      email: payload.user.email
    });
    return session;
  } catch (error) {
    logAppError('cloud-sync', '登录同步账号失败', {
      endpoint,
      email,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
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
  const normalizedVersion = parseSyncVersion(request.version, 0);
  const idempotencyKey = createIdempotencyKey();
  return withRetry('sync-push', async () => {
    const response = await withTimeout(`${endpoint}/sync/push`, {
      method: 'POST',
      headers: {
        ...authHeaders(session.token),
        'X-Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        version: normalizedVersion,
        encryptedBlobBase64: request.encryptedBlobBase64
      })
    });
    if (response.status === 409) {
      const parsed = await parseErrorPayload(response, '检测到版本冲突，请先拉取最新数据后重试。');
      const latest =
        parsed.latest !== undefined ? normalizeSyncPullResponse(parsed.latest) : null;
      if (latest && !latest.traceId && parsed.traceId) {
        latest.traceId = parsed.traceId;
      }
      throw new CloudSyncConflictError(parsed.message, latest, {
        code: parsed.code,
        traceId: parsed.traceId,
        retryable: parsed.retryable
      });
    }
    const payload = await readJson<unknown>(response, '同步上传失败，请稍后重试。');
    const normalized = normalizeSyncPushResponse(payload);
    if (!normalized.traceId) {
      normalized.traceId = readTraceIdFromHeaders(response);
    }
    return normalized;
  });
};

export const getCloudSyncStatus = async (session: CloudSyncSession): Promise<SyncStatusResponse> => {
  const endpoint = ensureHttpsEndpoint(session.apiBaseUrl);
  return withRetry('sync-status', async () => {
    const response = await withTimeout(`${endpoint}/sync/status`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    });
    const payload = await readJson<unknown>(response, '获取同步状态失败，请稍后重试。');
    const normalized = normalizeSyncStatusResponse(payload);
    if (!normalized.traceId) {
      normalized.traceId = readTraceIdFromHeaders(response);
    }
    return normalized;
  });
};

export const pullCloudSyncBlob = async (session: CloudSyncSession): Promise<SyncPullResponse> => {
  const endpoint = ensureHttpsEndpoint(session.apiBaseUrl);
  return withRetry('sync-pull', async () => {
    const response = await withTimeout(`${endpoint}/sync/pull`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    });
    const payload = await readJson<unknown>(response, '同步拉取失败，请稍后重试。');
    const normalized = normalizeSyncPullResponse(payload);
    if (!normalized.traceId) {
      normalized.traceId = readTraceIdFromHeaders(response);
    }
    return normalized;
  });
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

export const fetchCloudSyncPolicy = async (apiBaseUrl: string): Promise<CloudSyncPolicy> => {
  const endpoint = ensureHttpsEndpoint(apiBaseUrl);
  const response = await withTimeout(`${endpoint}/client/config`, {
    method: 'GET'
  });
  const payload = await readJson<Partial<CloudSyncPolicy>>(response, '读取客户端策略失败，请稍后重试。');
  return {
    defaultSyncDomain:
      typeof payload.defaultSyncDomain === 'string' ? payload.defaultSyncDomain.trim() : '',
    lockSyncDomain: payload.lockSyncDomain === true,
    hideSyncDomainInput: payload.hideSyncDomainInput === true,
    requireActivation: payload.requireActivation !== false,
    setupRequired: payload.setupRequired === true
  };
};

export const getCloudLicenseStatus = async (
  session: CloudSyncSession
): Promise<CloudLicenseStatus> => {
  const endpoint = ensureHttpsEndpoint(session.apiBaseUrl);
  const response = await withTimeout(`${endpoint}/license/status`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  return readJson<CloudLicenseStatus>(response, '读取授权状态失败，请稍后重试。');
};

export const activateCloudLicense = async (
  session: CloudSyncSession,
  code: string
): Promise<LicenseActivateResponse> => {
  const endpoint = ensureHttpsEndpoint(session.apiBaseUrl);
  const response = await withTimeout(`${endpoint}/license/activate`, {
    method: 'POST',
    headers: authHeaders(session.token),
    body: JSON.stringify({ code })
  });
  return readJson<LicenseActivateResponse>(response, '激活失败，请稍后重试。');
};
