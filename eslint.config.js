import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
    { ignores: ["dist/", "node_modules/", "scripts/tui-test/fixtures/", "scripts/*.mjs"] },

    js.configs.recommended,
    ...tseslint.configs.recommended,

    {
        plugins: {
            react: reactPlugin,
            "react-hooks": reactHooks,
        },
        settings: {
            react: { version: "detect" },
        },
        rules: {
            ...reactPlugin.configs.recommended.rules,
            ...reactHooks.configs.recommended.rules,
            "react/react-in-jsx-scope": "off",
            "react/prop-types": "off",
            "no-empty": ["error", { allowEmptyCatch: true }], // best-effort `try { ... } catch {}` is intentional
            // Type-only imports must say `import type`, so a bundler never keeps them alive as value imports.
            "@typescript-eslint/consistent-type-imports": [
                "error",
                { fixStyle: "inline-type-imports", disallowTypeAnnotations: false },
            ],
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
        },
    }
);
