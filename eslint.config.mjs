import js from '@eslint/js';
import globals from 'globals';
import regexp from 'eslint-plugin-regexp';
import stylisticJS from '@stylistic/eslint-plugin';

export default [
    { ignores: ['**/*cache', '**/*.min.{js,mjs}', '**/*.test.js', '**/package-lock.json', 'lib/**'] },
    {
        files: ['**/*.{js,mjs}'],
        languageOptions: {
            ecmaVersion: 'latest', sourceType: 'script',
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                ...globals.serviceworker,
                EventBus: 'readonly', RateLimiter: 'readonly', ServiceRegistry: 'readonly',
                DownloadManager: 'readonly', MangaPatcher: 'readonly', ExporterRegistry: 'readonly',
                PopupController: 'readonly', BaseService: 'readonly', BaseExporter: 'readonly',
                getExtensionApi: 'readonly', getBrowserEnv: 'readonly',
                serviceRegistry: 'readonly', module: 'readonly',
                globalRateLimiter: 'readonly', backgroundDownload: 'readonly',
                mangalibConfig: 'readonly', ranolibConfig: 'readonly'
            }
        },
        plugins: { 'js-styles': stylisticJS, regexp },
        rules: {
            ...js.configs.recommended.rules,
            ...regexp.configs['flat/recommended'].rules,
            'indent': 'off', 'no-unexpected-multiline': 'error', 'key-spacing': 'off',
            'js-styles/no-trailing-spaces': 'error',
            'js-styles/max-len': ['error', {
                'code': 120,
                'ignoreTemplateLiterals': true
            }],
            'nonblock-statement-body-position': 'off',
            'curly': ['error', 'multi-or-nest'],
            'js-styles/no-extra-semi': 'error',
            'semi': ['error', 'always', {
                'omitLastInOneLineBlock': false,
                'omitLastInOneLineClassBody': false
            }],
            'semi-style': ['error', 'last'],
            'quotes': ['error', 'single', { 'allowTemplateLiterals': true }],
            'comma-dangle': ['error', 'never'],
            'no-constant-condition': 'off',
            'no-empty': 'off',
            'no-inner-declarations': 'off',
            'no-useless-escape': 'off',
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-script-url': 'error',
            'no-useless-concat': 'error',
            'no-self-assign': 'error',
            'no-unmodified-loop-condition': 'error',
            'no-useless-return': 'error',
            'no-with': 'error',
            'no-unused-vars': ['error', { 'caughtErrors': 'none' }],
            'regexp/prefer-character-class': 'error',
            'regexp/prefer-quantifier': 'error',
            'regexp/prefer-regexp-exec': 'error',
            'no-duplicate-case': 'error',
            'no-dupe-else-if': 'error',
            'no-lonely-if': 'error',
            'no-self-compare': 'error',
            'no-unneeded-ternary': 'error',
            'no-useless-catch': 'error',
            'complexity': ['warn', 20],
            'prefer-template': 'error',
            'arrow-body-style': ['error', 'as-needed'],
            'camelcase': ['error', {
                properties: 'always',
                ignoreDestructuring: false,
                allow: ['rus_name']
            }],
            'dot-notation': 'error',
            'guard-for-in': 'error',
            'no-else-return': 'error',
            'no-multi-assign': 'error',
            'no-nested-ternary': 'error',
            'no-new-wrappers': 'error',
            'no-param-reassign': 'error',
            'no-plusplus': ['error', { allowForLoopAfterthoughts: true }],
            'no-throw-literal': 'error',
            'operator-assignment': ['error', 'always'],
            'prefer-object-spread': 'error',
            'no-var': 'error',
            'prefer-const': ['error', {
                destructuring: 'any',
                ignoreReadBeforeAssign: false
            }],
            'prefer-destructuring': ['error', {
                array: true,
                object: true
            }, { enforceForRenamedProperties: false }],
            'prefer-rest-params': 'error',
            'prefer-spread': 'error',
            'prefer-arrow-callback': 'error',
            'no-duplicate-imports': 'error',
            'no-use-before-define': ['error', {
                functions: false,
                classes: true,
                variables: true
            }],
            'padding-line-between-statements': [
                'error',
                { blankLine: 'always', prev: ['function', 'class'], next: '*' },
                { blankLine: 'always', prev: '*', next: ['function', 'class'] },
                { blankLine: 'always', prev: 'block-like', next: 'block-like' }
            ],
            'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0, maxBOF: 0 }],
            'padded-blocks': ['error', 'never'],
            'sort-imports': ['error', {
                ignoreCase: true,
                ignoreDeclarationSort: true
            }],
            'block-scoped-var': 'error',
            'no-extra-bind': 'error',
            'no-iterator': 'error',
            'no-loop-func': 'warn',
            'no-proto': 'error',
            'no-redeclare': 'error',
            'no-shadow': 'error',
            'no-undefined': 'error',
            'no-undef': 'error',
            'no-unused-expressions': 'error',
            'require-await': 'warn',
            'no-alert': 'warn',
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'Identifier[name=/[а-яё]/i]',
                    message: 'В именах переменных запрещена кириллица.'
                }
            ],
            'no-restricted-globals': [
                'error',
                {
                    name: 'event',
                    message: 'Use local parameter name instead of global event'
                }
            ]
        }
    }
];
