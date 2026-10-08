/** Tokens extracted from the GasMan/GHOURI Figma shell: royal-blue top bar, deep-navy sidebar, light canvas, white cards. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef4ff', 100: '#dbe7ff', 200: '#bcd2ff', 500: '#3b6ff0', 600: '#2563eb', 700: '#1d4fd8', 800: '#1e40af' },
        navy: { 700: '#16254d', 800: '#101d42', 900: '#0b1530', 950: '#080f24' },
        canvas: '#f3f5fa',
        ink: { DEFAULT: '#0f172a', soft: '#475569', mute: '#64748b' },
        line: '#e2e8f0',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(15,23,42,.05), 0 1px 1px rgba(15,23,42,.03)', pop: '0 10px 30px rgba(15,23,42,.18)' },
    },
  },
  plugins: [],
};
