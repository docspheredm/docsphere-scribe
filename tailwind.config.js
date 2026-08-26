/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './extension-src/**/*.{html,ts,tsx}',
    './App.tsx',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
