import type { Config } from 'tailwindcss';

// Design tokens translated 1:1 from
// `/Users/macbook/Documents/TO DO/recallraid/DESIGN.md`
// ("RecallRaid Tactical Intelligence" design system).
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#101319',
          dim: '#101319',
          bright: '#363940',
          lowest: '#0b0e14',
          low: '#191c22',
          container: '#1d2026',
          high: '#272a30',
          highest: '#32353b',
        },
        on: {
          surface: '#e1e2ea',
          'surface-variant': '#b9cacb',
        },
        outline: { DEFAULT: '#849495', variant: '#3a494b' },
        primary: {
          DEFAULT: '#00dbe7',
          on: '#00363a',
          container: '#00f2ff',
          'on-container': '#006a71',
          fixed: '#74f5ff',
          'fixed-dim': '#00dbe7',
        },
        secondary: {
          DEFAULT: '#fd8b00',
          on: '#4d2600',
          container: '#fd8b00',
          'on-container': '#603100',
          fixed: '#ffdcc3',
          'fixed-dim': '#ffb77d',
        },
        danger: {
          DEFAULT: '#FF3B3B',
          container: '#93000a',
          on: '#690005',
        },
        status: {
          safe: '#00FF66',
          disputed: '#B8BCC2',
          danger: '#FF3B3B',
        },
        bg: {
          deep: '#0A0C0E',
          base: '#101319',
        },
        border: {
          subtle: '#2D323A',
        },
        muted: '#8E96A3',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jbmono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        'headline-lg': ['24px', { lineHeight: '32px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-md': ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'headline-lg-mobile': ['20px', { lineHeight: '28px', fontWeight: '700' }],
        'body-md': ['13px', { lineHeight: '20px' }],
        'body-sm': ['11px', { lineHeight: '16px' }],
        'label-caps': ['10px', { lineHeight: '12px', letterSpacing: '0.08em', fontWeight: '700' }],
        'data-mono': ['12px', { lineHeight: '18px', fontWeight: '500' }],
      },
      borderRadius: {
        sm: '0.125rem',
        DEFAULT: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
      },
      spacing: {
        gutter: '16px',
        'margin-mobile': '16px',
        'margin-desktop': '32px',
      },
      maxWidth: {
        container: '1440px',
      },
      boxShadow: {
        'glow-cyan': '0 0 8px rgba(0, 219, 231, 0.35)',
        'glow-orange': '0 0 8px rgba(253, 139, 0, 0.35)',
      },
      backgroundImage: {
        'locked-stripes':
          'repeating-linear-gradient(135deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 2px, transparent 2px, transparent 10px)',
      },
    },
  },
  plugins: [],
};

export default config;
