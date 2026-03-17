/** Abstraction for executing commands on a remote host. */
export interface RemoteExecutor {
  /** Execute a shell command on the remote host and return stdout. */
  exec(command: string, opts?: { timeout?: number }): Promise<string>;
  /** Copy a local file or directory to a path on the remote host. */
  copyTo(localPath: string, remotePath: string): Promise<void>;
}
