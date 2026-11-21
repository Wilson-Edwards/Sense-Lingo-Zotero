// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

export default zotero({
  overrides: [
    {
      files: ["**/*.ts"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
    {
      // Ambient global declarations must use `declare var`.
      files: ["typings/**/*.d.ts"],
      rules: {
        "no-var": "off",
      },
    },
  ],
});
