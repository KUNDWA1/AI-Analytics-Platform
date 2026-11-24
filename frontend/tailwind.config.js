/** Design tokens: one institutional palette (deep teal-navy primary, slate neutrals, semantic severity colours). */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef6f7', 100: '#d5e8ec', 200: '#aad0d8', 500: '#1f7a8c', 600: '#176675', 700: '#124f5b', 800: '#0f3d47', 900: '#0b2c34' },
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
