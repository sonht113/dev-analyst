import { describe, expect, it } from 'vitest';
import { readObservedAttributes } from './metadata.js';

describe('DOM attribute privacy boundary', () => {
  it('does not even request value, credential, arbitrary data, event, URL or HTML attributes', () => {
    const reads: string[] = [];
    const attributes: Record<string, string> = {
      id: 'button',
      role: 'button',
      'aria-label': 'Save',
      title: 'x'.repeat(1000),
      value: 'password',
      'data-token': 'secret',
      onclick: 'secret source',
      href: '/?token=secret',
      src: 'secret',
      action: '/secret',
      style: 'secret',
      srcdoc: '<input value="secret">',
    };
    const observed = readObservedAttributes(
      {
        localName: 'button',
        getAttribute: (name) => {
          reads.push(name);
          return attributes[name] ?? null;
        },
      },
      false,
    );
    expect(observed).toEqual({
      id: 'button',
      role: 'button',
      'aria-label': 'Save',
      title: 'x'.repeat(256),
    });
    expect(reads).not.toEqual(expect.arrayContaining(['value']));
    for (const key of [
      'value',
      'data-token',
      'onclick',
      'href',
      'src',
      'action',
      'style',
      'srcdoc',
    ])
      expect(reads).not.toContain(key);
  });
  it('redacted controls only request a syntactically bounded structural type', () => {
    const reads: string[] = [];
    expect(
      readObservedAttributes(
        {
          localName: 'input',
          getAttribute: (name) => {
            reads.push(name);
            return name === 'type' ? 'password' : 'secret';
          },
        },
        true,
      ),
    ).toEqual({ type: 'password' });
    expect(reads).toEqual(['type']);
    expect(
      readObservedAttributes(
        { localName: 'input', getAttribute: () => 'invalid secret value' },
        true,
      ),
    ).toEqual({});
  });
  it('private and editable containers request no attributes', () => {
    expect(
      readObservedAttributes(
        {
          localName: 'div',
          getAttribute: () => {
            throw new Error('Private attribute read');
          },
        },
        true,
      ),
    ).toEqual({});
  });
});
