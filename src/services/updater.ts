import { openExternalLink } from './externalLink';

export interface ReleaseCheckResult {
  hasUpdate: boolean;
  latestVersion?: string;
  releaseUrl?: string;
}

export interface ReleaseNoticeState {
  hasUpdate: boolean;
  latestVersion: string | null;
  releaseUrl: string | null;
  checkedAt: string | null;
}

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubReleasePayload {
  tag_name: string;
  html_url: string;
  assets: GithubReleaseAsset[];
}

const GITHUB_REPO = 'bigcaole/OrbitTerm';
const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
const GITHUB_REQUEST_TIMEOUT_MS = 10_000;

const RELEASE_NOTICE_KEY = 'orbitterm:release-notice:v1';
const DAILY_LOCK_CHECK_DAY_KEY = 'orbitterm:release-check:auto-lock:day';

const normalizeVersion = (version: string): string => {
  return version.trim().replace(/^v/i, '').split('-')[0] ?? version.trim();
};

const compareVersions = (current: string, next: string): number => {
  const currentParts = normalizeVersion(current)
    .split('.')
    .map((part) => Number(part) || 0);
  const nextParts = normalizeVersion(next)
    .split('.')
    .map((part) => Number(part) || 0);
  const length = Math.max(currentParts.length, nextParts.length);

  for (let index = 0; index < length; index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const nextPart = nextParts[index] ?? 0;
    if (nextPart > currentPart) {
      return 1;
    }
    if (nextPart < currentPart) {
      return -1;
    }
  }

  return 0;
};

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json'
      }
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('版本检测超时，请稍后重试。');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutHandle);
  }
};

const defaultReleaseNoticeState = (): ReleaseNoticeState => ({
  hasUpdate: false,
  latestVersion: null,
  releaseUrl: null,
  checkedAt: null
});

const safeReadStorage = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch (_error) {
    return null;
  }
};

const safeWriteStorage = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch (_error) {
    // Ignore storage write errors.
  }
};

const safeRemoveStorage = (key: string): void => {
  try {
    window.localStorage.removeItem(key);
  } catch (_error) {
    // Ignore storage remove errors.
  }
};

const serializeReleaseNotice = (notice: ReleaseNoticeState): string => {
  return JSON.stringify(notice);
};

const parseReleaseNotice = (raw: string): ReleaseNoticeState => {
  try {
    const parsed = JSON.parse(raw) as Partial<ReleaseNoticeState>;
    return {
      hasUpdate: Boolean(parsed.hasUpdate),
      latestVersion: typeof parsed.latestVersion === 'string' ? parsed.latestVersion : null,
      releaseUrl: typeof parsed.releaseUrl === 'string' ? parsed.releaseUrl : null,
      checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : null
    };
  } catch (_error) {
    return defaultReleaseNoticeState();
  }
};

const resolveReleaseUrl = (payload: GithubReleasePayload): string => {
  const firstAsset = payload.assets[0];
  return firstAsset?.browser_download_url ?? payload.html_url;
};

export const readReleaseNoticeState = (): ReleaseNoticeState => {
  const raw = safeReadStorage(RELEASE_NOTICE_KEY);
  if (!raw) {
    return defaultReleaseNoticeState();
  }
  return parseReleaseNotice(raw);
};

export const writeReleaseNoticeState = (notice: ReleaseNoticeState): void => {
  safeWriteStorage(RELEASE_NOTICE_KEY, serializeReleaseNotice(notice));
};

export const clearReleaseNoticeState = (): void => {
  safeRemoveStorage(RELEASE_NOTICE_KEY);
};

export const checkReleaseAvailability = async (currentVersion: string): Promise<ReleaseCheckResult> => {
  const response = await fetchWithTimeout(GITHUB_LATEST_RELEASE_API, GITHUB_REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`版本检测失败（HTTP ${response.status}）`);
  }

  const payload = (await response.json()) as GithubReleasePayload;
  const latestVersion = normalizeVersion(payload.tag_name);
  const hasUpdate = compareVersions(currentVersion, latestVersion) < 0;

  return {
    hasUpdate,
    latestVersion: hasUpdate ? latestVersion : undefined,
    releaseUrl: resolveReleaseUrl(payload)
  };
};

export const rememberDailyLockCheck = (dayLabel: string): void => {
  safeWriteStorage(DAILY_LOCK_CHECK_DAY_KEY, dayLabel);
};

export const wasDailyLockChecked = (dayLabel: string): boolean => {
  return safeReadStorage(DAILY_LOCK_CHECK_DAY_KEY) === dayLabel;
};

export const openReleasePage = async (url?: string): Promise<void> => {
  await openExternalLink(url ?? GITHUB_RELEASES_URL);
};
