import { describe, it, expect } from 'vitest';
import { decodeEntities, escapeHtml, escapeXml, sanitizeFilename } from '../../core/TextUtils.js';

describe('core/text', () => {
    it('escapeXml escapes the five XML characters', () => {
        expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
        expect(escapeXml(0)).toBe('');
        expect(escapeXml(null)).toBe('');
        expect(escapeXml(12)).toBe('12');
    });

    it('escapeHtml escapes quotes as HTML entities', () => {
        expect(escapeHtml(`'<b>' "&"`)).toBe('&#39;&lt;b&gt;&#39; &quot;&amp;&quot;');
        expect(escapeHtml(undefined)).toBe('');
    });

    it('decodeEntities decodes the basic entities', () => {
        expect(decodeEntities('&lt;p&gt;&nbsp;&quot;a&quot; &apos;b&#39; &#039;c&#039; &AMP;')).toBe('<p> "a" \'b\' \'c\' &');
        expect(decodeEntities('')).toBe('');
    });

    it('decodeEntities decodes &amp; last, so an escaped entity stays text', () => {
        expect(decodeEntities('&amp;lt;b&amp;gt; &amp;amp;')).toBe('&lt;b&gt; &amp;');
    });

    it('escapeXml and decodeEntities are inverse for text', () => {
        const text = `Глава "1" <первая> & 'вторая'`;
        expect(decodeEntities(escapeXml(text))).toBe(text);
    });

    it('sanitizeFilename replaces forbidden and control characters and limits the length', () => {
        expect(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j.pdf')).toBe('a_b_c_d_e_f_g_h_i_j.pdf');
        expect(sanitizeFilename('tab\there\nnew')).toBe('tab_here_new');
        expect(sanitizeFilename('x'.repeat(300))).toHaveLength(200);
        expect(sanitizeFilename('long name', 4)).toBe('long');
        expect(sanitizeFilename(null)).toBe('');
    });
});
