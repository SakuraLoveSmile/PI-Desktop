import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register(new URL('./helpers/ts-import-hooks.mjs', import.meta.url));
const { activityResources } = await import('../src/features/chat/activity/session-activity-model.ts');

const message = (id, extra = {}) => ({ id, role: 'tool', content: '', createdAt: '2026-10-10T01:00:00Z',
  toolName: 'Edit', toolStatus: 'success', toolArgs: { path: 'src/view.ts' }, ...extra });
const review = (id, extra = {}) => ({ details: { root: 'workspace', review: {
  version: 1, snapshotId: `snapshot:${id}`, messageId: id, path: 'src/view.ts',
  operation: 'edit', status: 'modified', state: 'active', additions: 2, deletions: 1,
  hunks: [], reversible: true, ...extra,
} } });

test('loaded successful file changes merge once with counts and the latest message to locate', () => {
  const first = message('first', { toolResult: review('first'), toolCompletedAt: '2026-10-10T01:01:00Z' });
  const latest = message('latest', { toolResult: review('latest', { additions: 3, deletions: 4 }),
    toolCompletedAt: '2026-10-10T01:03:00Z' });
  const resources = activityResources([latest, first,
    message('error', { toolStatus: 'error' }), message('denied', { toolStatus: 'denied' }),
    message('running', { toolStatus: 'running' }), message('flagged', { isError: true }),
    message('claim', { role: 'assistant', content: 'Created imaginary.ts' }),
    message('plugin', { toolName: 'plugin_Write' }),
  ]);
  assert.deepEqual(resources.changedFiles, [{ id: 'src/view.ts', label: 'src/view.ts', path: 'src/view.ts',
    changeCount: 2, messageId: 'latest', lastChangedAt: '2026-10-10T01:03:00Z', groupLabel: 'src',
    addedLines: 5, removedLines: 5 }]);
});

test('literal paths preserve case, relative aliases, and Unix backslashes without filesystem guesses', () => {
  const paths = ['src/A.ts', 'src/a.ts', './src/a.ts', 'src/../src/a.ts', 'literal\\name.ts',
    'C:\\Project\\src\\a.ts', '\\\\server\\share\\a.ts', '/root/a.ts', 'top.ts'];
  const rows = activityResources(paths.map((path, index) => message(String(index), { toolArgs: { path } }))).changedFiles;
  assert.deepEqual(rows.map((row) => row.path), paths);
  assert.deepEqual(rows.map((row) => row.groupLabel), ['src', 'src', './src', 'src/../src', undefined,
    'C:\\Project\\src', '\\\\server\\share', '/root', undefined]);
});

test('legacy Edit snippets do not establish trustworthy full-file line metrics', () => {
  const rows = activityResources([message('legacy', { toolArgs: { file_path: 'a.txt',
    old_string: 'old\nunchanged\nlast\n', new_string: 'new\nunchanged\nend\n' } }),
  message('crlf', { toolName: 'edit', toolArgs: { filePath: 'b.txt', oldText: 'same\r\nold', newText: 'same\r\nnew\r\nadded' } }),
  message('insert', { toolArgs: { path: 'c.txt', old_string: '', new_string: 'one\n' } }),
  message('newline-boundary', { toolArgs: { path: 'd.txt', old_string: 'abc\n', new_string: 'abc' } })]).changedFiles;
  assert.deepEqual(rows.map(({ addedLines, removedLines }) => [addedLines, removedLines]), Array.from({ length: 4 }, () => [undefined, undefined]));
});

test('mixed known edits and unknown writes keep change counts without incomplete diff totals', () => {
  const rows = activityResources([message('known', { toolResult: review('known') }),
    message('unknown', { toolName: 'Write', toolArgs: { path: 'src/view.ts', content: 'whole replacement\n' } }),
    message('write', { toolName: 'Write', toolArgs: { path: 'new.txt', content: 'new\n' },
      toolResult: review('write', { path: 'new.txt', status: 'added', operation: 'write', additions: 1, deletions: 0 }) }),
  ]).changedFiles;
  assert.equal(rows[0].changeCount, 2);
  assert.equal(rows[0].addedLines, undefined);
  assert.equal(rows[0].removedLines, undefined);
  assert.equal(rows[1].addedLines, 1);
  assert.equal(rows[1].removedLines, 0);
});

test('truncated, binary, mismatched and oversized evidence never becomes zero or invented diff metrics', () => {
  const large = Array.from({ length: 600 }, (_, index) => `line${index}`).join('\n');
  const records = [message('truncated', { toolResult: review('truncated', { truncated: true, additions: 0, deletions: 0 }) }),
    message('binary', { toolArgs: { path: 'binary' }, toolResult: review('binary', { path: 'binary', binary: true }) }),
    message('wrong-id', { toolArgs: { path: 'mismatch' }, toolResult: review('another', { path: 'mismatch' }) }),
    message('ops', { toolArgs: { path: 'ops', tag: 'ABCD', ops: 'REM', old_string: 'old', new_string: 'new' } }),
    message('large', { toolArgs: { path: 'large', old_string: large, new_string: `${large}\nnew` } }),
  ];
  for (const row of activityResources(records).changedFiles) {
    assert.equal(row.addedLines, undefined);
    assert.equal(row.removedLines, undefined);
  }
});

test('source domains use the first safe URL and count citation occurrences in loaded messages only', () => {
  const sourceMessage = (id, sources) => ({ id, role: 'assistant', content: '', createdAt: '2026-10-10T01:00:00Z',
    hostedSearch: { status: 'completed', rounds: [{ id: 'search', status: 'completed', sources }] } });
  const first = sourceMessage('one', [
    { url: 'https://docs.example.org/start', title: 'Start' },
    { url: 'https://docs.example.org/other', title: 'Other' },
    { url: 'https://user:password@evil.example.org/a' }, { url: 'javascript:alert(1)' }, { url: 'malformed' },
  ]);
  const second = sourceMessage('two', [{ url: 'http://DOCS.EXAMPLE.ORG:8080/start' },
    { url: 'https://other.example.org/' }, { url: 'https://docs.example.org/start' }]);
  assert.deepEqual(activityResources([first, second]).websites, [
    { id: 'https://docs.example.org/start', label: 'Start', url: 'https://docs.example.org/start', domain: 'docs.example.org', sourceCount: 4 },
    { id: 'https://other.example.org/', label: 'other.example.org', url: 'https://other.example.org/', domain: 'other.example.org', sourceCount: 1 },
  ]);
  assert.equal(activityResources([second]).websites[0].sourceCount, 2);
  assert.equal(activityResources([]).websites.length, 0);
});

test('resource aggregation preserves recorded attachments, skills, MCP and empty memory semantics', () => {
  const resources = activityResources([message('resources', { toolName: 'mcp_docs_find',
    attachments: [{ kind: 'file', name: 'a.txt', ref: 'a.txt' }, { kind: 'session', ref: 'session-b' }],
    skillMentions: [{ id: 'review', start: 0, end: 1 }],
  }), message('skill', { toolName: 'Skill', toolArgs: { id: 'build' } })]);
  assert.deepEqual(resources.attachments, [{ id: 'a.txt', label: 'a.txt', path: 'a.txt' }]);
  assert.deepEqual(resources.references, { memory: [], skills: [{ id: 'review', label: 'review' }, { id: 'build', label: 'build' }],
    mcp: [{ id: 'mcp_docs_find', label: 'mcp_docs_find' }] });
});
