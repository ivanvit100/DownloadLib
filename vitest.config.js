import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        bail: 1,
        environment: 'jsdom',
        include: ['tests/**/*.test.js'],
        execArgv: ['--no-experimental-webstorage'],
        // Тесты проверяют и отладочные сообщения логгера (core/logger.js).
        env: { DOWNLOADLIB_LOG_LEVEL: 'debug' },
        coverage: {
            provider: 'istanbul',
            reporter: ['text', 'html', 'json'],
            exclude: ['**/node_modules/**', '**/lib/**', '**/background/service-worker.js', '**/**/**/config.js', '/assembly/**', '**/tests/**'],
            all: true,
            include: ['*.js', 'core/**/*.js', 'background/**/*.js', 'content/**/*.js', 'exporters/**/*.js', 'services/**/*.js', 'ui/**/*.js'],
        },
    },
});
