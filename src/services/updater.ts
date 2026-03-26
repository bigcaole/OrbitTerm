import { checkUpdate, installUpdate, type UpdateManifest } from '@tauri-apps/api/updater';
import { openExternalLink } from './externalLink';

export interface UpdateCheckResult {
  shouldUpdate: boolean;
  manifest?: UpdateManifest;
  channel: 'tauri' | 'github';
  downloadUrl?: string;
  releaseUrl?: string;
}

export interface RepositoryPulseResult {
  hasNewCommits: boolean;
  aheadBy: number;
  latestCommitSha?: string;
  compareUrl?: string;
}

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubReleasePayload {
  tag_name: string;
  html_url: string;
  published_at?: string;
  assets: GithubReleaseAsset[];
}

interface GithubCompareCommit {
  sha: string;
}

interface GithubComparePayload {
  status?: string;
  ahead_by?: number;
  html_url?: string;
  commits?: GithubCompareCommit[];
}

const GITHUB_REPO = 'bigcaole/OrbitTerm';
const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const GITHUB_COMPARE_API = `https://api.github.com/repos/${GITHUB_REPO}/compare`;
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

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

const pickDownloadUrl = (payload: GithubReleasePayload): string => {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('windows')) {
    const exe = payload.assets.find((asset) => asset.name.endsWith('.exe'));
    if (exe) {
      return exe.browser_download_url;
    }
    const msi = payload.assets.find((asset) => asset.name.endsWith('.msi'));
    if (msi) {
      return msi.browser_download_url;
    }
  }

  if (ua.includes('mac')) {
    const dmg = payload.assets.find((asset) => asset.name.endsWith('.dmg'));
    if (dmg) {
      return dmg.browser_download_url;
    }
  }

  const fallback = payload.assets[0];
  if (fallback) {
    return fallback.browser_download_url;
  }
  return payload.html_url;
};

const checkGithubReleaseUpdate = async (
  currentVersion: string
): Promise<UpdateCheckResult> => {
  const response = await fetch(GITHUB_LATEST_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json'
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub 更新检测失败（HTTP ${response.status}）`);
  }

  const payload = (await response.json()) as GithubReleasePayload;
  const latestVersion = normalizeVersion(payload.tag_name);
  const hasUpdate = compareVersions(currentVersion, latestVersion) < 0;

  return {
    shouldUpdate: hasUpdate,
    manifest: {
      version: latestVersion
    } as UpdateManifest,
    channel: 'github',
    downloadUrl: hasUpdate ? pickDownloadUrl(payload) : payload.html_url,
    releaseUrl: payload.html_url
  };
};

export const checkForUpdate = async (
  currentVersion: string
): Promise<UpdateCheckResult> => {
  try {
    const result = await checkUpdate();
    return {
      shouldUpdate: result.shouldUpdate,
      manifest: result.manifest,
      channel: 'tauri'
    };
  } catch (_error) {
    return checkGithubReleaseUpdate(currentVersion);
  }
};

export const installAvailableUpdate = async (
  context: UpdateCheckResult
): Promise<void> => {
  if (context.channel === 'tauri') {
    await installUpdate();
    return;
  }

  if (!context.downloadUrl) {
    throw new Error('未找到可用下载链接，请稍后重试。');
  }

  await openExternalLink(context.downloadUrl);
};

export const checkRepositoryPulse = async (currentVersion: string): Promise<RepositoryPulseResult> => {
  const baseTag = `v${normalizeVersion(currentVersion)}`;
  const response = await fetch(`${GITHUB_COMPARE_API}/${encodeURIComponent(baseTag)}...main`, {
    headers: {
      Accept: 'application/vnd.github+json'
    }
  });

  if (response.status === 404) {
    return {
      hasNewCommits: false,
      aheadBy: 0
    };
  }

  if (!response.ok) {
    throw new Error(`仓库更新检测失败（HTTP ${response.status}）`);
  }

  const payload = (await response.json()) as GithubComparePayload;
  const aheadBy = Math.max(payload.ahead_by ?? 0, 0);
  const latestCommitSha =
    payload.commits && payload.commits.length > 0
      ? payload.commits[payload.commits.length - 1]?.sha
      : undefined;

  return {
    hasNewCommits: aheadBy > 0,
    aheadBy,
    latestCommitSha,
    compareUrl: payload.html_url
  };
};

export const openReleasePage = async (): Promise<void> => {
  await openExternalLink(GITHUB_RELEASES_URL);
};
