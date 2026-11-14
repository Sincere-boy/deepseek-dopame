import { DatabaseSync } from 'node:sqlite'

/** OS-released lease: a second backend must fail before binding its public socket. */
export function acquireHarnessLease(path) {
  const database = new DatabaseSync(path)
  try {
    database.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE')
    return database
  } catch (error) {
    database.close()
    throw new Error('此 DSH 数据目录已有运行中的实例，拒绝重复启动以保护工作区和服务连接。', { cause: error })
  }
}
