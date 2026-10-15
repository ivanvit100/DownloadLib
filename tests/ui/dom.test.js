import { describe, it, expect, beforeEach } from 'vitest';
import { $el, createEl, setDisplay } from '../../ui/dom.js';

beforeEach(() => {
    document.body.innerHTML = '<div id="box" style="display:block"></div>';
});

describe('$el', () => {
    it('Finds an element by id or returns null', () => {
        expect($el('box')).toBe(document.getElementById('box'));
        expect($el('missing')).toBeNull();
    });
});

describe('setDisplay', () => {
    it('Sets display of an existing element and ignores a missing one', () => {
        expect(setDisplay('box', 'none')).toBe(document.getElementById('box'));
        expect(document.getElementById('box').style.display).toBe('none');
        expect(setDisplay('missing', 'none')).toBeNull();
    });
});

describe('createEl', () => {
    it('Creates an element with a class, text and attributes', () => {
        const el = createEl('a', { className: 'link big', text: 'Открыть', attrs: { href: '#', 'data-id': 5 } });
        expect(el.tagName).toBe('A');
        expect(el.className).toBe('link big');
        expect(el.textContent).toBe('Открыть');
        expect(el.getAttribute('href')).toBe('#');
        expect(el.getAttribute('data-id')).toBe('5');
    });

    it('Never parses the text as HTML', () => {
        const el = createEl('div', { text: '<img src=x onerror="alert(1)"><b>x</b>' });
        expect(el.children).toHaveLength(0);
        expect(el.textContent).toBe('<img src=x onerror="alert(1)"><b>x</b>');
    });

    it('Skips empty options and attributes without a value', () => {
        const el = createEl('span', { attrs: { title: null, role: undefined, value: 0 } });
        expect(el.className).toBe('');
        expect(el.textContent).toBe('');
        expect(el.hasAttribute('title')).toBe(false);
        expect(el.hasAttribute('role')).toBe(false);
        expect(el.getAttribute('value')).toBe('0');
        expect(createEl('p').outerHTML).toBe('<p></p>');
        expect(createEl('p', { text: 0 }).textContent).toBe('0');
    });
});
