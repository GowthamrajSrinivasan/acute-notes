import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
  { ignores: [".next/**", ".next-prod/**", "node_modules/**", "next-env.d.ts", "public/**", "dist-desktop/**", "electron/**", "scripts/**/*.cjs"] },
];

export default config;
