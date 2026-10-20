/**
 * Мок модуля для vi.mock, экспорты которого читаются из хранилища моков теста
 * в момент обращения. Так тест может подменять зависимость в beforeEach или
 * внутри отдельного теста, не трогая globalThis.
 *
 * Использование:
 *   const mocks = vi.hoisted(() => ({}));
 *   vi.mock('../../core/EventBus.js', async () =>
 *       (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'EventBus'));
 *   vi.mock('../../background/TokenStore.js', async () =>
 *       (await import('../helpers/ModuleMock.js')).mockExports(mocks, { getToken: 'tsGetToken' }));
 *   ...
 *   mocks.EventBus = vi.fn(...);
 *
 * @param {object} store - Хранилище моков теста (результат vi.hoisted).
 * @param {...(string|Object<string, string>)} specs - Имена экспортов, совпадающие
 * с ключами хранилища, либо объекты вида { имяЭкспорта: 'ключХранилища' }.
 * @returns {object} Объект-мок модуля с геттерами, читающими хранилище.
 */
export function mockExports(store, ...specs) {
    const target = {};
    for (const spec of specs) {
        const pairs = typeof spec === 'string' ? [[spec, spec]] : Object.entries(spec);
        for (const [exportName, key] of pairs) {
            Object.defineProperty(target, exportName, {
                enumerable: true,
                get: () => store[key]
            });
        }
    }
    return target;
}
