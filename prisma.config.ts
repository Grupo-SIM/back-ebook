// Load .env only if it exists (for local development)
// In Docker/production, env vars are passed directly via runtime config
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not available or .env doesn't exist - that's OK
}

// Fallback values for when env vars are not available (e.g., during prisma generate)
const databaseUrl = process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/dbname'
const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/dbname'

// Try to use defineConfig if available, otherwise use plain object
let config: any
try {
  const { defineConfig } = require('@prisma/config')

  config = defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
      path: 'prisma/migrations',
    },
    datasource: {
      url: databaseUrl,
      directUrl: directUrl,
    },
  })
} catch (e) {
  // Fallback: plain object configuration
  config = {
    schema: 'prisma/schema.prisma',
    migrations: {
      path: 'prisma/migrations',
    },
    datasource: {
      url: databaseUrl,
      directUrl: directUrl,
    },
  }
}

module.exports = config
