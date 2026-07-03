/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primária — verde petróleo / teal escuro
        petroleum: {
          50: '#f0f7f6',
          100: '#d9ebe9',
          200: '#b3d7d3',
          300: '#84bcb6',
          400: '#549b95',
          500: '#357f79',
          600: '#296661',
          700: '#22524e',
          800: '#1d433f',
          900: '#163433',
          950: '#0c2322',
        },
        // Fundo geral (off-white frio)
        surface: '#eef2f2',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 40 38 / 0.04), 0 4px 14px -6px rgb(16 40 38 / 0.08)',
        soft: '0 1px 2px 0 rgb(16 40 38 / 0.06)',
      },
    },
  },
  plugins: [],
};
