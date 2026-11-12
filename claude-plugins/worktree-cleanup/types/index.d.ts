/** The linked worktree this session runs in. */
export type Worktree = {
  /** The worktree's top folder, absolute. */
  path: string
  /** The main checkout, where `git worktree remove` runs. */
  main: string
  /** The checked-out branch, or null when HEAD is detached. */
  branch: string | null
  /** The project's teardown command (argv), run in the worktree first; null when there is none. */
  teardown: string[] | null
}

export type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm'; dirty: number }
  | { kind: 'running'; step: string }
  | { kind: 'failed'; step: 'teardown' | 'remove'; message: string }
  | { kind: 'done' }
  | { kind: 'hidden' }

declare module 'claude-code' {
  interface PluginState {
    'worktree-cleanup': { worktree: Worktree | null; phase: Phase }
  }
}
