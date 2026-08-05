/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        embu: {
          green: "#0b5d34",
          gold: "#c9a227",
        },
      },
    },
  },
  plugins: [],
};
