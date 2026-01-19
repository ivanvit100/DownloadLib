import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        include: ['tests/**/*.test.js'],
        coverage: {
            provider: 'istanbul',
            reporter: ['text', 'html'],
            exclude: ['**/node_modules/**', '**/lib/**'],
            all: true,
            include: ['*.js', 'core/**/*.js', 'background/**/*.js', 'exporters/**/*.js', 'services/**/*.js', 'ui/**/*.js'],
        },
    },
});