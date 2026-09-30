import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'main.js',
      '**/tests/**',
      'src/bib/cslList.ts',
      'src/bib/cslLangList.ts',
      '*.mjs',
      '*.cjs',
      '*.js',
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.*'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
