/** Replaced with real Agenda wiring in the jobs task. When Agenda is not running
 * (tests, or before boot completes) these are safe no-ops: immediate posts publish
 * inline, and scheduled posts are caught up on next boot. */
export async function schedulePostPublish(_postId: string, _when: Date): Promise<void> {}

export async function cancelPostPublish(_postId: string): Promise<void> {}
