/* eslint-disable no-console -- this module is the legitimate console boundary; all other code should call logger.* */

type LogLevel = 'error' | 'warn' | 'info' | 'debug'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
}

function getCurrentLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL ?? '').toLowerCase()
  if (env === 'error' || env === 'warn' || env === 'info' || env === 'debug') {
    return env
  }
  return process.env.NODE_ENV === 'production' ? 'warn' : 'debug'
}

const currentLevel: LogLevel = getCurrentLevel()

function should(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[currentLevel]
}

export const logger = {
  error: (msg: string, ...rest: unknown[]) => {
    if (should('error')) console.error(`[error] ${msg}`, ...rest)
  },
  warn: (msg: string, ...rest: unknown[]) => {
    if (should('warn')) console.warn(`[warn] ${msg}`, ...rest)
  },
  info: (msg: string, ...rest: unknown[]) => {
    if (should('info')) console.info(`[info] ${msg}`, ...rest)
  },
  debug: (msg: string, ...rest: unknown[]) => {
    if (should('debug')) console.debug(`[debug] ${msg}`, ...rest)
  },
}
