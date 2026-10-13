/**
 * DownloadLib core module
 * Chapter list helpers: keys, sorting, translator branches and the chosen range
 * @module core/chapters
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

/**
 * Возвращает ключ главы, по которому она находится в списке независимо от порядка
 * и фильтров: id главы, а без него — том и номер.
 * @param {{id?: *, volume?: *, number?: *}} chapter - Глава из списка глав API.
 * @returns {string} Ключ главы.
 */
export function chapterKey(chapter) {
    if (chapter?.id != null && chapter.id !== '') return String(chapter.id);
    return `v${chapter?.volume ?? ''}_ch${chapter?.number ?? ''}`;
}

/**
 * Сортирует главы по возрастанию номера тома, а внутри тома — по номеру главы.
 * Исходный массив не меняется.
 * @param {object[]} chapters - Главы.
 * @returns {object[]} Новый отсортированный массив.
 */
export function sortChapters(chapters) {
    return [...chapters].sort((a, b) => {
        const volA = parseInt(a.volume) || 0;
        const volB = parseInt(b.volume) || 0;
        if (volA !== volB) return volA - volB;
        return (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0);
    });
}

/**
 * Оставляет главы указанной ветки перевода и помечает их этой веткой (branchId
 * нужен запросу главы). Без ветки возвращает список как есть.
 * @param {object[]} chapters - Главы со списком веток branches.
 * @param {?number} branchId - id ветки перевода, либо null.
 * @returns {object[]} Главы ветки.
 */
export function filterByBranch(chapters, branchId) {
    if (branchId == null) return chapters;
    return chapters
        .filter(ch => Array.isArray(ch.branches) && ch.branches.some(b => b.branch_id === branchId))
        .map(ch => ({ ...ch, branchId }));
}

/**
 * Выбирает диапазон глав по ключам первой и последней главы.
 * @param {object[]} chapters - Главы в порядке чтения.
 * @param {?{fromKey: string, toKey: string}} range - Диапазон, либо null — все главы.
 * @returns {object[]} Главы диапазона.
 * @throws {Error} Если глава диапазона не найдена или начало позже конца.
 */
export function selectRange(chapters, range) {
    if (!range) return chapters;
    const from = chapters.findIndex(ch => chapterKey(ch) === String(range.fromKey));
    const to = chapters.findIndex(ch => chapterKey(ch) === String(range.toKey));
    if (from === -1 || to === -1)
        throw new Error('Выбранные главы не найдены в списке глав тайтла: откройте тайтл заново и выберите диапазон');
    if (from > to) throw new Error('Начало диапазона глав позже его конца');
    return chapters.slice(from, to + 1);
}
