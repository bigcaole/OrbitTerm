import { useEffect, useState } from 'react';
import { getAppVersion } from '../../services/appInfo';
import { openExternalLink } from '../../services/externalLink';
import { openReleasePage, type ReleaseNoticeState } from '../../services/updater';

interface AboutLoyuModalProps {
  open: boolean;
  onClose: () => void;
  releaseNotice: ReleaseNoticeState;
}

const GITHUB_URL = 'https://github.com/bigcaole/OrbitTerm';
const WEBSITE_URL = 'https://orbitterm.app';

const formatCheckTime = (value: string | null): string => {
  if (!value) {
    return '尚未完成自动检测';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '尚未完成自动检测';
  }
  return date.toLocaleString('zh-CN', { hour12: false });
};

export function AboutLoyuModal({ open, onClose, releaseNotice }: AboutLoyuModalProps): JSX.Element | null {
  const [version, setVersion] = useState<string>('0.1.15');

  useEffect(() => {
    if (!open) {
      return;
    }

    let mounted = true;
    void getAppVersion()
      .then((nextVersion) => {
        if (mounted && nextVersion.trim()) {
          setVersion(nextVersion.trim());
        }
      })
      .catch(() => {
        if (mounted) {
          setVersion('0.1.15');
        }
      });

    return () => {
      mounted = false;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-white/30 bg-[#0a1321]/85 p-6 text-slate-100 shadow-2xl backdrop-blur-2xl sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8fb2e6]">About OrbitTerm</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">关于轨连终端</h2>
            <p className="mt-2 text-sm text-[#b7c9e7]">版本 {version} · 为高强度运维与安全连接而生。</p>
          </div>
          <button
            className="rounded-lg border border-[#314969] bg-[#111f34] px-3 py-1.5 text-xs text-[#c7d8f3] hover:bg-[#162946]"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <section className="rounded-2xl border border-[#2a3f5d] bg-[#0d1a2b]/75 p-4">
            <h3 className="text-sm font-semibold text-[#dceaff]">致谢</h3>
            <p className="mt-2 text-xs leading-6 text-[#9fb5d7]">
              OrbitTerm 基于 React、Tauri、Rust、xterm.js 与 russh 构建，感谢所有开源维护者。
            </p>
          </section>

          <section className="rounded-2xl border border-[#2a3f5d] bg-[#0d1a2b]/75 p-4">
            <h3 className="text-sm font-semibold text-[#dceaff]">链接</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="rounded-lg border border-[#35547d] bg-[#12233a] px-3 py-1.5 text-xs font-medium text-[#d4e5ff] hover:bg-[#193152]"
                onClick={() => {
                  void openExternalLink(GITHUB_URL);
                }}
                type="button"
              >
                GitHub
              </button>
              <button
                className="rounded-lg border border-[#35547d] bg-[#12233a] px-3 py-1.5 text-xs font-medium text-[#d4e5ff] hover:bg-[#193152]"
                onClick={() => {
                  void openExternalLink(WEBSITE_URL);
                }}
                type="button"
              >
                官网
              </button>
            </div>
          </section>
        </div>

        <section className="mt-4 rounded-2xl border border-[#2a3f5d] bg-[#0d1a2b]/75 p-4">
          <h3 className="text-sm font-semibold text-[#dceaff]">版本下载提示</h3>
          {releaseNotice.hasUpdate ? (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-emerald-200">检测到可下载新版本：{releaseNotice.latestVersion ?? '未知版本'}</p>
              <p className="text-[11px] text-[#9fb5d7]">
                最近检测时间：{formatCheckTime(releaseNotice.checkedAt)}
              </p>
              <button
                className="rounded-lg border border-emerald-400/70 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-400/20"
                onClick={() => {
                  void openReleasePage(releaseNotice.releaseUrl ?? undefined);
                }}
                type="button"
              >
                前往下载页
              </button>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-[#b7c9e7]">当前未检测到可下载新版本。</p>
              <p className="text-[11px] text-[#9fb5d7]">
                最近检测时间：{formatCheckTime(releaseNotice.checkedAt)}
              </p>
            </div>
          )}
          <p className="mt-3 text-[11px] leading-5 text-[#8aa4cb]">
            应用内已移除直接更新功能，自动检测到新版本后会在本页面提示你下载。
          </p>
        </section>
      </div>
    </div>
  );
}
