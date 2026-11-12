// A band above the prompt in a session that runs in a linked git worktree.
// "Clean up worktree" asks once, then, with no model turn:
//   1. runs the project's teardown task in the worktree, when it has one
//      (a Mix project whose mix.exs defines `worktree.teardown`), and
//   2. runs `git worktree remove <path>` from the main checkout.
// The branch is kept. A worktree with uncommitted changes is not removed.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Phase, Worktree } from '../types'

const worktree = atom({ plugin: 'worktree-cleanup', key: 'worktree' } as const, null)
const phase = atom({ plugin: 'worktree-cleanup', key: 'phase' } as const, { kind: 'idle' })

const TEARDOWN_TIMEOUT_MS = 5 * 60 * 1000

async function git($: EngineInterface, cwd: string, args: string[]) {
  return $.process.run(['git', ...args], { cwd, timeoutMs: 30_000 })
}

/** The last lines of a failed command's output, for the band. */
function tail(out: { stdout: string; stderr: string }, lines = 6): string {
  const text = `${out.stderr}\n${out.stdout}`.trim()
  return text.split('\n').slice(-lines).join('\n') || 'no output'
}

async function findMise($: EngineInterface): Promise<string | null> {
  const home = await $.env.get('HOME')
  const dirs = [`${home}/.local/bin`, `${home}/local/bin`, '/opt/homebrew/bin', '/usr/local/bin']
  for (const dir of dirs) {
    const stat = await $.fs.stat(`${dir}/mise`).catch(() => undefined)
    if (stat?.kind === 'file') return `${dir}/mise`
  }
  return null
}

async function findTeardown($: EngineInterface, top: string): Promise<string[] | null> {
  const mixExs = await $.fs.read(`${top}/mix.exs`).catch(() => '')
  if (!/["']worktree\.teardown["']/.test(mixExs)) return null
  const mise = await findMise($)
  return mise ? [mise, 'exec', '--', 'mix', 'worktree.teardown'] : ['mix', 'worktree.teardown']
}

/** The linked worktree `cwd` is in, or null for a main checkout or no repository. */
async function detect($: EngineInterface, cwd: string): Promise<Worktree | null> {
  const out = await git($, cwd, [
    'rev-parse',
    '--path-format=absolute',
    '--show-toplevel',
    '--git-dir',
    '--git-common-dir',
  ]).catch(() => null)
  if (!out || out.exitCode !== 0) return null

  const [path, gitDir, commonDir] = out.stdout.trim().split('\n')
  if (!path || !gitDir || !commonDir || gitDir === commonDir) return null

  const repo = await $.session.repo().catch(() => null)
  const main = repo?.root && repo.root !== path ? repo.root : commonDir.replace(/\/\.git\/?$/, '')
  if (main === path || main === commonDir) return null

  const head = await git($, path, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => null)
  const branch = head?.exitCode === 0 ? head.stdout.trim() : null

  return { path, main, branch, teardown: await findTeardown($, path) }
}

async function setPhase($: EngineInterface, next: Phase) {
  await update($, phase, () => next)
}

async function askToConfirm($: EngineInterface, wt: Worktree) {
  const status = await git($, wt.path, ['status', '--porcelain']).catch(() => null)
  if (!status || status.exitCode !== 0) {
    await setPhase($, { kind: 'failed', step: 'remove', message: status ? tail(status) : 'git status did not run' })
    return
  }
  const dirty = status.stdout.split('\n').filter(Boolean).length
  await setPhase($, { kind: 'confirm', dirty })
}

async function cleanUp($: EngineInterface, wt: Worktree, skipTeardown: boolean) {
  if (wt.teardown && !skipTeardown) {
    await setPhase($, { kind: 'running', step: `Running ${wt.teardown.slice(-2).join(' ')}…` })
    const out = await $.process
      .run(wt.teardown, { cwd: wt.path, timeoutMs: TEARDOWN_TIMEOUT_MS })
      .catch((err: unknown) => ({ exitCode: 1, stdout: '', stderr: String(err) }))
    if (out.exitCode !== 0) {
      await setPhase($, { kind: 'failed', step: 'teardown', message: tail(out) })
      return
    }
  }

  await setPhase($, { kind: 'running', step: 'Removing the worktree…' })
  const out = await git($, wt.main, ['worktree', 'remove', wt.path]).catch((err: unknown) => ({
    exitCode: 1,
    stdout: '',
    stderr: String(err),
  }))
  if (out.exitCode !== 0) {
    await setPhase($, { kind: 'failed', step: 'remove', message: tail(out) })
    return
  }

  await setPhase($, { kind: 'done' })
  $.ui.toast(`Removed worktree ${basename(wt.path)}`)
}

function basename(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const found = await detect($, e.cwd)
    await update($, worktree, () => found)
    // A reload keeps the phase; only a finished or hidden band stays as it was.
    await update($, phase, (p): Phase => (p.kind === 'done' || p.kind === 'hidden' ? p : { kind: 'idle' }))
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const wt = await read($, worktree)
    const p = await read($, phase)
    const isBusy = p.kind === 'running' || p.kind === 'confirm' || p.kind === 'failed'

    if (!wt || p.kind === 'hidden' || e.props.hasSurvey || (e.props.isWorking && !isBusy)) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const name = basename(wt.path)
    const branch = wt.branch ? ` (branch ${wt.branch} is kept)` : ''

    if (p.kind === 'idle') {
      return (
        <Box gap={1}>
          <Text dimColor>Worktree {name}</Text>
          <Button key="clean" label="Clean up worktree" dimColor onPress={() => askToConfirm($, wt)} />
          <Button key="hide" label="Hide" dimColor onPress={() => setPhase($, { kind: 'hidden' })} />
        </Box>
      )
    }

    if (p.kind === 'confirm' && p.dirty > 0) {
      return (
        <Box flexDirection="column">
          <Text color="warning">
            {name} has {p.dirty} uncommitted {p.dirty === 1 ? 'change' : 'changes'}. Commit or stash them first.
          </Text>
          <Box gap={1}>
            <Button key="cancel" label="OK" onPress={() => setPhase($, { kind: 'idle' })} />
          </Box>
        </Box>
      )
    }

    if (p.kind === 'confirm') {
      const steps = wt.teardown
        ? `Runs ${wt.teardown.slice(-2).join(' ')}, then git worktree remove`
        : 'Runs git worktree remove'
      return (
        <Box flexDirection="column">
          <Text>
            Remove worktree {name}? {steps}{branch}.
          </Text>
          <Box gap={1}>
            <Button key="remove" label="Remove" variant="primary" onPress={() => cleanUp($, wt, false)} />
            <Button key="cancel" label="Cancel" onPress={() => setPhase($, { kind: 'idle' })} />
          </Box>
        </Box>
      )
    }

    if (p.kind === 'running') {
      return <Text dimColor>{p.step}</Text>
    }

    if (p.kind === 'failed') {
      return (
        <Box flexDirection="column">
          <Text color="error">{p.step === 'teardown' ? 'Teardown failed:' : 'Worktree not removed:'}</Text>
          <Text dimColor>{p.message}</Text>
          <Box gap={1}>
            {p.step === 'teardown' ? (
              <Button key="skip" label="Remove without teardown" onPress={() => cleanUp($, wt, true)} />
            ) : null}
            <Button key="close" label="Close" onPress={() => setPhase($, { kind: 'idle' })} />
          </Box>
        </Box>
      )
    }

    return <Text dimColor>Worktree {name} removed. You can archive this session.</Text>
  })
}
