import { open } from '@tauri-apps/api/shell';

export const openExternalLink = async (url: string): Promise<void> => {
  try {
    await open(url);
    return;
  } catch (_error) {
    // Fall back for browser preview mode.
  }

  window.open(url, '_blank', 'noopener,noreferrer');
};
