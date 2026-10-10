import * as fs from 'fs';

/** Atomic replacement: a failed write never truncates the last good store.
 * The caller retains its dirty bit on any failure and can retry later. */
export function writeAccountsAtomically(file: string, data: string,
  io: Pick<typeof fs, 'openSync' | 'writeFileSync' | 'fsyncSync' | 'closeSync' | 'renameSync' | 'unlinkSync'> = fs): void {
  const temp = `${file}.${process.pid}.tmp`;
  let fd: number | undefined;
  let created = false;
  try {
    fd = io.openSync(temp, 'wx', 0o600);
    created = true;
    io.writeFileSync(fd, data);
    io.fsyncSync(fd);
    io.closeSync(fd); fd = undefined;
    io.renameSync(temp, file);
  } catch (error) {
    if (fd !== undefined) { try { io.closeSync(fd); } catch { /* preserve original failure */ } }
    if (created) { try { io.unlinkSync(temp); } catch { /* no completed temporary file */ } }
    throw error;
  }
}
