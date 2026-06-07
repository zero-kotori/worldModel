import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}", "./tests/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17202a",
        panel: "#f8faf9",
        line: "#d8dedb",
        moss: "#3f7d5a",
        berry: "#a83f62",
        amber: "#b77b2b"
      }
    }
  },
  plugins: []
};

export default config;
