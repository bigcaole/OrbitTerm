import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        frost: {
          base: '#eaf1fb',
          panel: 'rgba(255,255,255,0.58)',
          border: 'rgba(255,255,255,0.62)',
          accent: '#0a84ff',
          accentSoft: '#3d8bfd'
        }
      },
      boxShadow: {
        glass: '0 24px 48px rgba(43, 63, 96, 0.16)',
        panel: '0 14px 34px rgba(44, 72, 117, 0.14)'
      }
    }
  },
  plugins: []
};

export default config;
