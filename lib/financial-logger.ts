/**
 * Financial API Logging Utility
 * Centralized logging system for financial operations
 */

import { NextResponse } from 'next/server'

export interface LogContext {
  timestamp?: string
  level?: 'debug' | 'info' | 'warn' | 'error' | 'critical'
  component?: string
  operation?: string
  operationId?: string
  userId?: string
  groupId?: string
  duration?: number
  [key: string]: unknown
}

interface DatabaseErrorLike {
  message?: string
  code?: string
  details?: string
  hint?: string
}

interface ErrorLike {
  message?: string
  stack?: string
  name?: string
}

export interface LogEntry extends LogContext {
  timestamp: string
  operationId: string
}

export class FinancialLogger {
  private static generateOperationId(): string {
    return `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  private static createLogEntry(context: LogContext): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      operationId: context.operationId || this.generateOperationId(),
      level: context.level || 'info',
      component: context.component || 'unknown',
      operation: context.operation || 'unknown',
      ...context
    }
  }

  /**
   * Log operation start
   */
  static startOperation(context: Omit<LogContext, 'level' | 'timestamp'>): { 
    operationId: string, 
    startTime: number,
    log: (additionalContext?: Partial<LogContext>) => void
  } {
    const operationId = this.generateOperationId()
    const startTime = Date.now()
    
    const logEntry = this.createLogEntry({
      ...context,
      level: 'info',
      operationId
    })

    console.log(`🚀 ${context.operation} - Start`, logEntry)

    return {
      operationId,
      startTime,
      log: (additionalContext = {}) => {
        const entry = this.createLogEntry({
          ...context,
          ...additionalContext,
          level: additionalContext.level || 'info',
          operationId,
          duration: Date.now() - startTime
        })
        
        const emoji = this.getEmojiForLevel(entry.level || 'info')
        console.log(`${emoji} ${entry.operation}`, entry)
      }
    }
  }

  /**
   * Log successful operation completion
   */
  static success(context: LogContext, additionalData?: Record<string, unknown>): void {
    const logEntry = this.createLogEntry({
      ...context,
      level: 'info',
      ...additionalData
    })

    console.log(`✅ ${context.operation} - Success`, logEntry)
  }

  /**
   * Log validation error
   */
  static validationError(context: LogContext, validationDetails: unknown): void {
    const logEntry = this.createLogEntry({
      ...context,
      level: 'warn',
      validation: validationDetails
    })

    console.log(`🚫 ${context.operation} - Validation Error`, logEntry)
  }

  /**
   * Log database error
   */
  static databaseError(context: LogContext, error: unknown): void {
    const dbError = error as DatabaseErrorLike
    const logEntry = this.createLogEntry({
      ...context,
      level: 'error',
      error: {
        message: dbError.message,
        code: dbError.code,
        details: dbError.details,
        hint: dbError.hint
      }
    })

    console.error(`🗄️ ${context.operation} - Database Error`, logEntry)
  }

  /**
   * Log authentication error
   */
  static authError(context: LogContext): void {
    const logEntry = this.createLogEntry({
      ...context,
      level: 'warn'
    })

    console.log(`🔒 ${context.operation} - Auth Error`, logEntry)
  }

  /**
   * Log general error
   */
  static error(context: LogContext, error: unknown): void {
    const errLike = error as ErrorLike
    const logEntry = this.createLogEntry({
      ...context,
      level: 'error',
      error: {
        message: errLike.message,
        stack: errLike.stack,
        name: errLike.name
      }
    })

    console.error(`❌ ${context.operation} - Error`, logEntry)
  }

  /**
   * Log performance warning
   */
  static performance(context: LogContext, threshold: number = 1000): void {
    if (context.duration && context.duration > threshold) {
      const logEntry = this.createLogEntry({
        ...context,
        level: 'warn'
      })

      console.warn(`🐌 ${context.operation} - Slow Operation`, logEntry)
    }
  }

  /**
   * Log financial calculation
   */
  static financialCalculation(context: LogContext, calculationData: unknown): void {
    const logEntry = this.createLogEntry({
      ...context,
      level: 'info',
      calculation: calculationData
    })

    console.log(`🧮 ${context.operation} - Financial Calculation`, logEntry)
  }

  /**
   * Log data access audit trail
   */
  static dataAccess(context: LogContext, accessDetails: unknown): void {
    const logEntry = this.createLogEntry({
      ...context,
      level: 'info',
      access: accessDetails
    })

    console.log(`👁️ ${context.operation} - Data Access`, logEntry)
  }

  /**
   * Log data modification audit trail
   */
  static dataModification(context: LogContext, modificationDetails: unknown): void {
    const logEntry = this.createLogEntry({
      ...context,
      level: 'info',
      modification: modificationDetails
    })

    console.log(`📝 ${context.operation} - Data Modification`, logEntry)
  }

  private static getEmojiForLevel(level: string): string {
    const emojis: Record<string, string> = {
      debug: '🔍',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
      critical: '🚨'
    }
    return emojis[level] || 'ℹ️'
  }
}

/**
 * Middleware wrapper for API routes with automatic logging
 */
export function withFinancialLogging<T extends unknown[], R>(
  component: string,
  operation: string,
  handler: (...args: T) => Promise<R>
) {
  return async (...args: T): Promise<R> => {
    const { operationId, startTime, log } = FinancialLogger.startOperation({
      component,
      operation
    })

    try {
      const result = await handler(...args)
      
      log({
        level: 'info',
        duration: Date.now() - startTime,
        status: 'success'
      })

      return result
    } catch (error) {
      FinancialLogger.error({
        component,
        operation,
        operationId,
        duration: Date.now() - startTime
      }, error)
      
      throw error
    }
  }
}

/**
 * Create API response with logging
 */
export function createLoggedResponse(
  context: LogContext,
  data: unknown,
  status: number = 200
): Response {
  if (status >= 400) {
    FinancialLogger.error(context, { httpStatus: status, responseData: data })
  } else {
    FinancialLogger.success(context, { httpStatus: status })
  }

  return NextResponse.json(data, { status })
}

export default FinancialLogger