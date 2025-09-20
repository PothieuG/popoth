# Tech Stack & Configuration

## Tech Stack
- **Frontend**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Backend**: Supabase (Auth + Database)
- **Package Manager**: pnpm
- **Development Aid**: Context7 MCP Server

## MCP Server Configuration

### ✅ Context7 Status: CONFIGURED AND FUNCTIONAL
- **Status**: Installed and operational
- **Functionality**: Real-time documentation access working
- **Last Tested**: 2025-09-13 - Successfully resolved React library documentation

### ❌ Playwright Status: REMOVED
- **Status**: Completely removed from project
- **Reason**: User requested removal of all Playwright-related files and dependencies

### 🔧 Claude Desktop Configuration
**Required configuration for `claude_desktop_config.json`:**
```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["@upstash/context7-mcp@latest"]
    }
  }
}
```
**Location**: `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
**After changes**: Restart Claude Desktop completely

## 🎯 Current Tech Stack (Updated)
- **Frontend**: Next.js 15.5.3 with App Router
- **Language**: TypeScript 5.x (ES2022 target)
- **Styling**: Tailwind CSS 3.4.x
- **UI Components**: shadcn/ui (latest)
- **Backend**: Supabase (Auth + Database) - ✅ configured and functional
- **Package Manager**: pnpm
- **Linting**: ESLint 9.x (flat config)

## 🔧 Technical Architecture
- **Modern Next.js 15** with App Router and Server Components
- **Supabase authentication** with `signUp()` and `signInWithPassword()`
- **JWT token management** with `jose` library for secure encryption
- **Middleware-based route protection** for application-wide security
- **React Context** for global authentication state management
- **Custom hooks** (`useAuth`, `useLogin`, `useRequireAuth`) for clean component integration
- **Server/client separation** for secure cookie and session handling
- **API routes** (`/api/auth/session`) for authentication operations
- **Automatic session refresh** to maintain user sessions seamlessly