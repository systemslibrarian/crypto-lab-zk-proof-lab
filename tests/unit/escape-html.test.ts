import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../../js/shared.js';

describe('escapeHtml', () => {
  it('escapes every character that changes the meaning of HTML', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('escapes the ampersand first, so the other escapes are not re-escaped', () => {
    // Replacing & last would turn the &lt; this produces into &amp;lt;.
    expect(escapeHtml('<a>')).toBe('&lt;a&gt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves a payload inert: no tag characters survive', () => {
    const payload = '<img src=x onerror="document.title=\'xss\'">';
    const escaped = escapeHtml(payload);
    expect(escaped).not.toMatch(/[<>"']/);
    // and nothing is lost — the text is all still there, in escaped form
    expect(escaped).toContain('img src=x onerror=');
  });

  it('renders non-strings through String(), rather than throwing on them', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(true)).toBe('true');
    expect(escapeHtml(null)).toBe('null');
    expect(escapeHtml(undefined)).toBe('undefined');
  });
});
