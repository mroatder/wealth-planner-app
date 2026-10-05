// macOS-style theme. Colours are CSS variables (see assets/css/main.css) so the whole app
// follows the system Light/Dark setting from one place.
const c = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  theme: {
    extend: {
      colors: {
        paper: c('paper'),     // window background
        surface: c('surface'), // cards, inputs
        ink: c('ink'),
        muted: c('muted'),
        faint: c('faint'),
        line: c('line'),
        accent: c('accent'),   // system blue
        income: c('income'),
        expense: c('expense'),
        warn: c('warn'),
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'Inter',
          '"Sukhumvit Set"', '"Noto Sans Thai"', 'system-ui', 'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 0 0 0.5px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.05)',
        seg: '0 0 0 0.5px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.12)',
      },
    },
  },
};
