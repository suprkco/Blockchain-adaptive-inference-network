export default [{
  files: ['**/*.js'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: {
    process: 'readonly', console: 'readonly', __dirname: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly', describe: 'readonly',
    it: 'readonly', beforeEach: 'readonly',
  } },
  rules: { 'no-unused-vars': 'error', 'no-undef': 'error', 'no-unreachable': 'error', 'no-dupe-args': 'error', 'no-constant-condition': 'error', 'valid-typeof': 'error' },
}, { files: ['compute/*.js'], languageOptions: { sourceType: 'commonjs' } }];
