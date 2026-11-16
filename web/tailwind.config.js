export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "#2563EB",
        accent: "#10B981",
        ink: "#0F172A",
        canvas: "#F8FAFC",
      },
      fontFamily: { sans: ["Poppins", "Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      boxShadow: { card: "0 1px 3px rgba(15, 23, 42, .07), 0 1px 2px rgba(15, 23, 42, .04)" },
    },
  },
  plugins: [],
};
