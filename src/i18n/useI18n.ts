import { useMemo } from 'react';
import { useUiSettingsStore } from '../store/useUiSettingsStore';
import { localeTagForLanguage, tWithLanguage } from './core';

export const useI18n = () => {
  const language = useUiSettingsStore((state) => state.language);

  return useMemo(() => {
    return {
      language,
      locale: localeTagForLanguage(language),
      t: (key: string, vars?: Record<string, string | number>) => tWithLanguage(language, key, vars)
    };
  }, [language]);
};
