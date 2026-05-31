/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./web/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        nunito: ["'Nunito'", 'sans-serif'],
      },
      fontSize: {
        xxs:      ['10px', { lineHeight: '1.4' }],
        'xs-plus': ['11px', { lineHeight: '1.45' }],
        'sm-':    ['13px', { lineHeight: '1.5' }],
      },
      maxWidth: {
        content:        '960px',
        'content-narrow': '820px',
      },
      colors: {
        bg: {
          primary:       'rgb(var(--bg-primary) / <alpha-value>)',
          secondary:     'rgb(var(--bg-secondary) / <alpha-value>)',
          tertiary:      'rgb(var(--bg-tertiary) / <alpha-value>)',
          hover:         'rgb(var(--bg-hover) / <alpha-value>)',
          'hover-subtle': 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))',
          'hover-muted':  'rgb(var(--bg-hover-muted) / var(--bg-hover-muted-alpha))',
          selected:      'rgb(var(--bg-selected) / <alpha-value>)',
          input:         'rgb(var(--bg-input) / <alpha-value>)',
          elevated:      'rgb(var(--bg-elevated) / <alpha-value>)',
        },
        text: {
          primary:   'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          emphasis:  'rgb(var(--text-emphasis) / <alpha-value>)',
          muted:     'rgb(var(--text-muted) / <alpha-value>)',
        },
        accent: {
          brand:       'rgb(var(--accent-brand) / <alpha-value>)',
          'brand-light': 'rgb(var(--accent-brand-light) / <alpha-value>)',
          'brand-deep': 'rgb(var(--accent-brand-deep) / <alpha-value>)',
          green:      'rgb(var(--accent-green) / <alpha-value>)',
          yellow:     'rgb(var(--accent-yellow) / <alpha-value>)',
          red:        'rgb(var(--accent-red) / <alpha-value>)',
          orange:     'rgb(var(--accent-orange) / <alpha-value>)',
          purple:     'rgb(var(--accent-purple) / <alpha-value>)',
          running:    'rgb(var(--accent-running) / <alpha-value>)',
        },
        border: {
          DEFAULT:  'rgb(var(--border-color) / <alpha-value>)',
          subtle:   'rgb(var(--border-subtle) / <alpha-value>)',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      keyframes: {
        'ping-soft': {
          '0%':   { transform: 'scale(1)',   opacity: '0.55' },
          '70%':  { transform: 'scale(2.2)', opacity: '0' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
      },
      animation: {
        'ping-soft': 'ping-soft 1.6s cubic-bezier(0, 0, 0.2, 1) infinite',
      },
    },
  },
  plugins: [],
}
