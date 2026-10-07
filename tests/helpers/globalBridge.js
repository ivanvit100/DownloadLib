/**
 * Временный мост для тестов на период перехода исходников на ES-модули.
 * Модули теперь получают зависимости через import, а существующие тесты подменяют
 * их через глобалы. Мост строит объект-мок модуля, экспорты которого лениво читаются
 * из globalThis в момент обращения, — так тесты продолжают управлять зависимостями
 * прежним способом. Удаляется при переводе тестов на vi.mock (этап 9 плана).
 *
 * Использование:
 *   vi.mock('../../core/EventBus.js', async () =>
 *       (await import('../helpers/globalBridge.js')).globalBridge('EventBus'));
 *   vi.mock('../../background/RequestInterceptor.js', async () =>
 *       (await import('../helpers/globalBridge.js')).globalBridge({ authTokens: 'authTokenStore' }));
 *
 * @param {...(string|Object<string, string>)} specs - Имена экспортов, совпадающие
 * с именами глобалов, либо объекты вида { имяЭкспорта: 'имяГлобала' }.
 * @returns {object} Объект-мок модуля с геттерами, читающими globalThis.
 */
export function globalBridge(...specs) {
    const target = {};
    for (const spec of specs) {
        const pairs = typeof spec === 'string' ? [[spec, spec]] : Object.entries(spec);
        for (const [exportName, globalName] of pairs) {
            Object.defineProperty(target, exportName, {
                enumerable: true,
                get: () => globalThis[globalName]
            });
        }
    }
    return target;
}
