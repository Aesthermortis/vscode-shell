export default {
  "**/*.{js,cjs,mjs,jsx,ts,tsx}": [
    "eslint --fix --max-warnings=0 --report-unused-disable-directives --no-warn-ignored",
  ],
  "**/*": ["prettier --write --ignore-unknown"],
};
