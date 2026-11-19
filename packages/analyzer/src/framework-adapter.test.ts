import { expect, it } from 'vitest';
import { createFrameworkAdapter } from './framework-adapter.js';
it('separates explicit Next client provenance from server JSX and uses independent Vue directives', () => {
  const next = createFrameworkAdapter('next-react');
  const server = next.instrument(
    'export default async function Page(){return <button>Server</button>}',
    'app/page.tsx',
    '/__devanalyst/mapping-runtime.js',
  );
  expect(server.map).toBeNull();
  expect(server.diagnostics).toContainEqual({ code: 'SERVER_BOUNDARY', source: null });
  const client = next.instrument(
    '/* module comment */\n"use client";import {useState} from "react";export default function Button(){return <button>Client</button>}',
    'app/Button.tsx',
    '/__devanalyst/mapping-runtime.js',
  );
  expect(client.manifest.framework).toBe('next-react');
  expect(client.manifest.sites).toHaveLength(1);
  const vue = createFrameworkAdapter('vue-vite');
  expect(vue.accepts('src/Button.tsx')).toBe(false);
  expect(vue.accepts('src/Button.vue')).toBe(true);
});
