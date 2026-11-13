import { expect, it } from 'vitest';
import { instrumentReactSource } from './instrumentation.js';

function inspect(jsx: string) {
  return instrumentReactSource(
    `export const App=()=>${jsx}`,
    'src/App.tsx',
    '/__devanalyst/mapping-runtime.js',
  );
}

it('keeps static translation provenance on the server, including nested text and entities', () => {
  const result = inspect('<button>保存 <span>&amp; 確認</span>{"する"}</button>');
  expect(result.inspections[0]?.literal).toMatchObject({
    text: '保存 & 確認 する',
    evidence: {
      code: '<button>保存 <span>&amp; 確認</span>{"する"}</button>',
      source: { file: 'src/App.tsx' },
    },
  });
  expect(result.code).not.toContain('"literal"');
  expect(result.manifest).not.toHaveProperty('inspections');
});

it.each([
  '<button>{account.name}</button>',
  '<button><Label/></button>',
  '<button>{items.map(x=>x.label)}</button>',
  '<button><span data-private>秘密</span>保存</button>',
])('does not treat dynamic or private descendants as public source literals: %s', (jsx) => {
  expect(inspect(jsx).inspections[0]?.literal).toBeNull();
});

it.each(['data-private', 'data-devanalyst-private', 'contentEditable'])(
  'inherits the %s privacy boundary',
  (attribute) => {
    const result = inspect(`<div ${attribute}><button>秘密</button></div>`);
    expect(result.inspections).toHaveLength(2);
    expect(result.inspections.every((origin) => origin.private && origin.literal === null)).toBe(
      true,
    );
  },
);

it('excludes input values and bounds oversized literals while supporting static labels', () => {
  expect(inspect('<input value="秘密"/>').inspections[0]).toMatchObject({
    private: true,
    literal: null,
  });
  expect(inspect('<button aria-label="保存"/>').inspections[0]?.literal?.text).toBe('保存');
  expect(inspect(`<button>${'日'.repeat(513)}</button>`).inspections[0]?.literal).toBeNull();
});
