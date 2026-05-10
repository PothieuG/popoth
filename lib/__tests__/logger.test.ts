import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

async function loadLogger(opts: { LOG_LEVEL?: string; NODE_ENV?: string }) {
  vi.stubEnv('LOG_LEVEL', opts.LOG_LEVEL ?? '')
  vi.stubEnv('NODE_ENV', opts.NODE_ENV ?? 'development')
  vi.resetModules()
  const mod = await import('@/lib/logger')
  return mod.logger
}

describe('logger', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let infoSpy: ReturnType<typeof vi.spyOn>
  let debugSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  describe('default level', () => {
    it('defaults to debug when NODE_ENV is not production (LOG_LEVEL unset)', async () => {
      const logger = await loadLogger({ NODE_ENV: 'development' })
      logger.error('e')
      logger.warn('w')
      logger.info('i')
      logger.debug('d')
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(infoSpy).toHaveBeenCalledTimes(1)
      expect(debugSpy).toHaveBeenCalledTimes(1)
    })

    it('defaults to warn in production (LOG_LEVEL unset)', async () => {
      const logger = await loadLogger({ NODE_ENV: 'production' })
      logger.error('e')
      logger.warn('w')
      logger.info('i')
      logger.debug('d')
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(infoSpy).not.toHaveBeenCalled()
      expect(debugSpy).not.toHaveBeenCalled()
    })
  })

  describe('LOG_LEVEL filtering', () => {
    it('LOG_LEVEL=error: only error fires', async () => {
      const logger = await loadLogger({ LOG_LEVEL: 'error', NODE_ENV: 'development' })
      logger.error('e')
      logger.warn('w')
      logger.info('i')
      logger.debug('d')
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).not.toHaveBeenCalled()
      expect(infoSpy).not.toHaveBeenCalled()
      expect(debugSpy).not.toHaveBeenCalled()
    })

    it('LOG_LEVEL=warn: error+warn fire, info+debug filtered', async () => {
      const logger = await loadLogger({ LOG_LEVEL: 'warn', NODE_ENV: 'development' })
      logger.error('e')
      logger.warn('w')
      logger.info('i')
      logger.debug('d')
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(infoSpy).not.toHaveBeenCalled()
      expect(debugSpy).not.toHaveBeenCalled()
    })

    it('LOG_LEVEL=info: error+warn+info fire, debug filtered', async () => {
      const logger = await loadLogger({ LOG_LEVEL: 'info', NODE_ENV: 'production' })
      logger.error('e')
      logger.warn('w')
      logger.info('i')
      logger.debug('d')
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(infoSpy).toHaveBeenCalledTimes(1)
      expect(debugSpy).not.toHaveBeenCalled()
    })

    it('LOG_LEVEL=debug: all four levels fire', async () => {
      const logger = await loadLogger({ LOG_LEVEL: 'debug', NODE_ENV: 'production' })
      logger.error('e')
      logger.warn('w')
      logger.info('i')
      logger.debug('d')
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(infoSpy).toHaveBeenCalledTimes(1)
      expect(debugSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('LOG_LEVEL fallback', () => {
    it('invalid LOG_LEVEL falls back to prod default (warn) when NODE_ENV=production', async () => {
      const logger = await loadLogger({ LOG_LEVEL: 'invalid', NODE_ENV: 'production' })
      logger.error('e')
      logger.warn('w')
      logger.info('i')
      logger.debug('d')
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(infoSpy).not.toHaveBeenCalled()
      expect(debugSpy).not.toHaveBeenCalled()
    })

    it('empty LOG_LEVEL falls back to dev default (debug) when NODE_ENV=development', async () => {
      const logger = await loadLogger({ LOG_LEVEL: '', NODE_ENV: 'development' })
      logger.debug('d')
      expect(debugSpy).toHaveBeenCalledTimes(1)
    })

    it('LOG_LEVEL is case-insensitive (INFO equivalent to info)', async () => {
      const logger = await loadLogger({ LOG_LEVEL: 'INFO', NODE_ENV: 'production' })
      logger.info('i')
      logger.debug('d')
      expect(infoSpy).toHaveBeenCalledTimes(1)
      expect(debugSpy).not.toHaveBeenCalled()
    })
  })

  describe('format and args', () => {
    it('prefixes [level] and forwards rest-spread args verbatim', async () => {
      const logger = await loadLogger({ LOG_LEVEL: 'debug', NODE_ENV: 'development' })
      logger.debug('msg', 1, 'a', { x: 2 })
      logger.error('boom', new Error('oops'))
      expect(debugSpy).toHaveBeenCalledWith('[debug] msg', 1, 'a', { x: 2 })
      expect(errorSpy).toHaveBeenCalledWith('[error] boom', expect.any(Error))
    })

    it('never calls console.log (logger uses info/debug, not log)', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const logger = await loadLogger({ LOG_LEVEL: 'debug', NODE_ENV: 'development' })
      logger.error('a')
      logger.warn('b')
      logger.info('c')
      logger.debug('d')
      expect(logSpy).not.toHaveBeenCalled()
    })
  })
})
