import { expect, test } from 'claude-code/testing'

const WT = '/repo/.claude/worktrees/feature-x'
const MAIN = '/repo'

const BAND = {
  plugin: 'worktree-cleanup',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

type Run = { argv: readonly string[]; cwd?: string }

/** Stands for the engine: a fake git and fs for a linked worktree of a Mix project. */
function fakeHost(on: any, opts: { dirty?: string; teardownFails?: boolean } = {}) {
  const runs: Run[] = []
  const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  const fail = (stderr: string) => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.repo', () => ({ value: { root: MAIN, remote: null, internal: false, name: null } }))
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.stat', (_: unknown, e: { path: string }) =>
    e.path === '/home/u/local/bin/mise'
      ? { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }
      : { deny: 'ENOENT' },
  )
  on('fs.read', (_: unknown, e: { path: string }) =>
    e.path === `${WT}/mix.exs` ? { value: 'aliases: ["worktree.teardown": ["ecto.drop"]]' } : { deny: 'ENOENT' },
  )
  on('process.run', (_: unknown, e: { argv: readonly string[]; init?: { cwd?: string } }) => {
    runs.push({ argv: e.argv, cwd: e.init?.cwd })
    const args = e.argv.join(' ')
    if (args.startsWith('git rev-parse')) return ok(`${WT}\n${MAIN}/.git/worktrees/feature-x\n${MAIN}/.git\n`)
    if (args.startsWith('git symbolic-ref')) return ok('feature-x\n')
    if (args.startsWith('git status')) return ok(opts.dirty ?? '')
    if (args.includes('worktree.teardown')) return opts.teardownFails ? fail('could not connect to postgres') : ok()
    if (args.startsWith('git worktree remove')) return ok()
    return fail(`unexpected: ${args}`)
  })
  on('ui.toast', () => ({ value: {} }))
  return runs
}

test('Remove runs the teardown in the worktree, then git worktree remove from main', async ($, on) => {
  const runs = fakeHost(on)
  await $.session.start({ cwd: WT, surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /Worktree feature-x/ }))).toBeTruthy()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'clean' })
  expect((await ui.find({ type: 'Text', text: /Remove worktree feature-x\?/ }))?.text).toContain('feature-x is kept')
  await ui.press({ key: 'remove' })

  const teardown = runs.find(r => r.argv.includes('worktree.teardown'))
  expect(teardown?.argv).toEqual(['/home/u/local/bin/mise', 'exec', '--', 'mix', 'worktree.teardown'])
  expect(teardown?.cwd).toBe(WT)
  const remove = runs.find(r => r.argv[1] === 'worktree')
  expect(remove?.argv).toEqual(['git', 'worktree', 'remove', WT])
  expect(remove?.cwd).toBe(MAIN)
  expect(await ui.find({ type: 'Text', text: /removed/ })).toBeTruthy()
  await ui.unmount()
})

test('uncommitted changes block the removal', async ($, on) => {
  const runs = fakeHost(on, { dirty: ' M lib/a.ex\n?? b.ex\n' })
  await $.session.start({ cwd: WT, surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'clean' })
  expect((await ui.find({ type: 'Text', text: /uncommitted/ }))?.text).toContain('2 uncommitted changes')
  expect(runs.some(r => r.argv[1] === 'worktree')).toBe(false)
  await ui.unmount()
})

test('a failed teardown offers to remove without it', async ($, on) => {
  const runs = fakeHost(on, { teardownFails: true })
  await $.session.start({ cwd: WT, surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'clean' })
  await ui.press({ key: 'remove' })
  expect(await ui.find({ type: 'Text', text: /postgres/ })).toBeTruthy()
  expect(runs.some(r => r.argv[1] === 'worktree')).toBe(false)

  await ui.press({ key: 'skip' })
  expect(runs.some(r => r.argv[1] === 'worktree')).toBe(true)
  await ui.unmount()
})

test('a main checkout draws no band', async ($, on) => {
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: `${MAIN}\n${MAIN}/.git\n${MAIN}/.git\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  // Stands for the engine's own drawing, which the band leaves to it.
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: MAIN, surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})
