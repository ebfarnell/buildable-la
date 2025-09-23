import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  js.configs.recommended,
  {
    ignores: [
      'dist/**',
      'build/**',
      'coverage/**',
      '.trash/**',
      'node_modules/**',
      'cache/**',
      'out/**',
      '*.min.js',
      '*.config.js',
      '*.config.cjs',
      '*.config.mjs',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
        project: false,
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'readonly',
        module: 'readonly',
        require: 'readonly',
        global: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortSignal: 'readonly',
        AbortController: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off', // TODO: Re-enable after TypeScript cleanup
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off', // TODO: Re-enable after cleanup
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-useless-catch': 'off',
      'no-empty': 'off', // Empty blocks have been addressed with comments
      'no-const-assign': 'error',
      'no-console': 'off',
      'no-debugger': 'error', // Should never have debugger in code
      'no-unused-vars': 'off',
      'prefer-const': 'off', // Already handled by auto-fix
      'no-var': 'error',
    },
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
      },
    },
    rules: {
      'no-console': 'off',
      'no-debugger': 'error', // Should never have debugger in code
      'prefer-const': 'off', // Already handled by auto-fix
      'no-var': 'error',
    },
  },
];
