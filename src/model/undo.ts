/**
 * In-memory undo store for edits made through the tools.
 *
 * Files stay the source of truth; snapshots only make "undo the last AI change"
 * cheap inside one host process (bounded, per absolute path). They are not a
 * durability mechanism — that is the `.drawio` file plus git.
 */

/** One bounded per-file snapshot stack. */
export class SnapshotStore {
  private readonly stacks = new Map<string, string[]>()

  /**
   * Record the content before a write.
   * @param path - absolute file path.
   * @param content - previous serialized content.
   */
  remember(path: string, content: string): void {
    const stack = this.stacks.get(path) ?? []
    stack.push(content)
    if (stack.length > this.depth) stack.splice(0, stack.length - this.depth)
    this.stacks.set(path, stack)
  }

  /**
   * Take the most recent snapshot for a path.
   * @param path - absolute file path.
   * @returns the previous content, or undefined when nothing is recorded.
   */
  undo(path: string): string | undefined {
    return this.stacks.get(path)?.pop()
  }

  /**
   * Number of snapshots kept for a path (diagnostics/tests).
   * @param path - absolute file path.
   * @returns the count.
   */
  depthOf(path: string): number {
    return this.stacks.get(path)?.length ?? 0
  }

  /**
   * @param depth - maximum snapshots per path (default 8).
   */
  constructor(private readonly depth = 8) {}
}
