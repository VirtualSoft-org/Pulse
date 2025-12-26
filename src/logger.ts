/**
 * Simple structured logger for Pulse
 */
const DEBUG = process.env.DEBUG === 'true'

export const log = {
  info: (module: string, msg: string, data?: any) => {
    if (data !== undefined) {
      console.log(`[${module}] ${msg}`, data)
    } else {
      console.log(`[${module}] ${msg}`)
    }
  },

  warn: (module: string, msg: string, data?: any) => {
    if (data !== undefined) {
      console.warn(`⚠️  [${module}] ${msg}`, data)
    } else {
      console.warn(`⚠️  [${module}] ${msg}`)
    }
  },

  error: (module: string, msg: string, data?: any) => {
    if (data !== undefined) {
      console.error(`❌ [${module}] ${msg}`, data)
    } else {
      console.error(`❌ [${module}] ${msg}`)
    }
  },

  debug: (module: string, msg: string, data?: any) => {
    if (!DEBUG) return
    if (data !== undefined) {
      console.log(`🔍 [${module}] ${msg}`, data)
    } else {
      console.log(`🔍 [${module}] ${msg}`)
    }
  },

  success: (module: string, msg: string, data?: any) => {
    if (data !== undefined) {
      console.log(`✅ [${module}] ${msg}`, data)
    } else {
      console.log(`✅ [${module}] ${msg}`)
    }
  },
}
