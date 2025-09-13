# Popoth_App_Claude

## Project Overview
A modern web application built with Next.js 15, TypeScript, shadcn/ui, and Supabase. Enhanced with Context7 MCP Server for real-time documentation during development.
The application is only for mobile, but could be used in desktop. Desktop beautiful UI and UX is not the priority.

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

## Custom Instructions for Claude

### 🌐 Language & Localization
- **CRITICAL**: ALL code, comments, documentation, logs, and technical content MUST be in English
- **Application UI**: French (target audience - only visible text to users)
- **No Exceptions**: Variable names, function names, comments, logs, markdown files - ALL English
- **Folder Names**: ALL folder/directory names MUST be in English - no French folder names
- **Rationale**: Code maintainability, international collaboration, technical standards

### 📚 Documentation & Research
- **CRITICAL**: Always use "use context7" in prompts before implementing features
- Always verify latest documentation for Next.js, React, TypeScript, Tailwind, shadcn/ui
- Check for breaking changes and best practices updates
- Update this CLAUDE.md when adopting new technologies or major features

### 🛠️ Development Workflow
- **Package Manager**: pnpm ONLY
- **NEVER RUN**: Do NOT run `pnpm dev`, `pnpm build`, or any development commands automatically
- **Code Quality**: Run lint + typecheck only if explicitly requested
- **Error Handling**: Fix warnings/errors when reported by user
- **Factorization**: Always look for reusable patterns and components
- **Loading States**: Add smooth loading animations for all data fetching
- **Documentation**: Each time you create a function, document it and explain what it does just above it
- **Code Quality**: Focus on clean, well-documented code without automated testing
- **Style**: I want consistency in the style and the theme of the application
- **Error handling**: Every time you are using an API or fetching data, implement a try/catch 

### 📱 Mobile-First Approach
- **Primary Target**: Mobile devices
- **Desktop**: Functional but not priority for UX polish
- **Responsive**: Use Tailwind mobile-first breakpoints

### 🗄️ Supabase Integration
- **Setup Guidance**: Provide step-by-step dashboard instructions when needed
- **Database Structure**: Document all table schemas in "Database Structure" section below
- **Environment**: Guide .env setup for Supabase connection

### 🚀 Development Server Management
- **Port**: NEVER Launch the app by yourself
- **Default Port**: http://localhost:3000 (as configured)

### 📊 Session Logging & Continuity
- **Progress Updates**: Update this CLAUDE.md with major milestones
- **Architecture Decisions**: Document significant technical choices
- **Feature Completion**: Mark features as ✅ complete with brief description
- **Next Steps**: Always maintain clear next actions list

### 🤝 Collaboration
- **Questions**: Ask for clarification when requirements are unclear
- **Confirmation**: Confirm approach for complex implementations
- **Guidance**: Request Supabase dashboard steps when backend changes needed

- **CRITICAL**: Always log development progress for session continuity and update CLAUDE.md
- **MANDATORY**: Use `logs/CURRENT_SESSION.md` for active session tracking (keep under 1000 lines)
- **IMPORTANT**: Update CLAUDE.md after each significant feature/fix - it's the project's memory
- **ESSENTIAL ON /reset**: ALWAYS start new conversations by reading `logs/CURRENT_SESSION.md` first
  - If CURRENT_SESSION.md doesn't exist, read the most recent `logs/dev-log-YYYY-MM.md`
  - This ensures complete context continuity after conversation resets
  - Do this BEFORE asking what the user wants to work on
- Archive completed sessions to `logs/dev-log-YYYY-MM.md` monthly
- When CURRENT_SESSION.md gets large (>50KB), archive and start fresh
- Always read CURRENT_SESSION.md at start of new sessions to understand project state
- Log major decisions, architecture changes, completed features, and next steps
- **Remember**: Poor logging = Lost progress and repeated work

### 🎯 Current Tech Stack (Updated)
- **Frontend**: Next.js 15.5.3 with App Router
- **Language**: TypeScript 5.x (ES2022 target)
- **Styling**: Tailwind CSS 3.4.x
- **UI Components**: shadcn/ui (latest)
- **Backend**: Supabase (Auth + Database) - ✅ configured and functional
- **Package Manager**: pnpm
- **Linting**: ESLint 9.x (flat config)

## 🚀 Developed Features

### ✅ Modern Authentication System (2025-09-13)
- **Login page** (`/connexion`) with complete Supabase authentication
- **Registration page** (`/inscription`) with account creation and email validation
- **Password reset** (`/mot-de-passe-oublie`) with complete flow
- **New password page** (`/reset-password`) with token validation
- **API confirmation route** (`/auth/confirm`) for email link management
- **Auth error page** (`/auth/auth-code-error`) for invalid/expired tokens
- **Dashboard page** (`/dashboard`) for authenticated users
- **Robust error handling** with specific messages in French
- **Smooth navigation** between auth pages
- **Client-side validation** (email, password, confirmation)
- **User feedback** for all error cases
- **Homepage** (`/`) with authentication-aware interface

### 🔐 Advanced Token Management System (2025-09-13)
- **JWT-based sessions** with secure token encryption using `jose` library
- **Automatic token refresh** every 50 minutes (before 1-hour expiration)
- **Session validation** every 5 minutes to verify authentication status
- **Secure HTTP-Only cookies** with SameSite protection
- **Middleware protection** on all application routes
- **Automatic logout** on token expiration or invalid sessions
- **Route protection** - authenticated users blocked from auth pages
- **Server-side session management** with Next.js API routes
- **Client-side auth context** with React Context and custom hooks

### 🎨 Design System
- **Mobile-first** with responsive design
- **Consistent gradients** (blue/purple theme)
- **shadcn/ui components** with customization
- **Roboto font** with hydration warning fixes
- **French interface** for end users

### 📱 Clean Dashboard Interface (2025-09-13)
- **Sticky navbar** with app branding and hamburger menu button
- **Full-width slide-out menu panel** with smooth animations (300ms ease-in-out)
- **Menu panel features**: Right-to-left slide animation, overlay backdrop, close button
- **Logout functionality** moved to menu panel with red styling
- **Sticky footer** ready for future content
- **Clean main content area** prepared for feature development
- **Smooth transitions** for all panel interactions using Tailwind CSS transforms

### 🔧 Technical Architecture
- **Modern Next.js 15** with App Router and Server Components
- **Supabase authentication** with `signUp()` and `signInWithPassword()`
- **JWT token management** with `jose` library for secure encryption
- **Middleware-based route protection** for application-wide security
- **React Context** for global authentication state management
- **Custom hooks** (`useAuth`, `useLogin`, `useRequireAuth`) for clean component integration
- **Server/client separation** for secure cookie and session handling
- **API routes** (`/api/auth/session`) for authentication operations
- **Automatic session refresh** to maintain user sessions seamlessly

## 🏗️ Authentication System Architecture

### 📁 File Structure
```
├── middleware.ts                    # Route protection and token validation
├── lib/
│   ├── session.ts                  # JWT token utilities (client/server agnostic)
│   ├── session-server.ts           # Server-side session management
│   ├── session-client.ts           # Client-side session utilities
│   └── auth.ts                     # Authentication API functions
├── contexts/
│   └── AuthContext.tsx             # React Context for global auth state
├── hooks/
│   └── useAuth.ts                  # Custom authentication hooks
├── app/
│   ├── api/auth/session/route.ts   # Authentication API endpoint
│   ├── layout.tsx                  # AuthProvider wrapper
│   ├── connexion/page.tsx          # Login page
│   ├── inscription/page.tsx        # Registration page
│   └── dashboard/page.tsx          # Protected dashboard
```

### 🔐 Security Features
- **JWT Secret Key**: Environment variable `JWT_SECRET_KEY` for token signing
- **HTTP-Only Cookies**: Prevent XSS attacks with secure cookie storage
- **Token Expiration**: 1-hour sessions with automatic refresh at 50 minutes
- **Route Protection**: Middleware blocks unauthorized access to protected routes
- **Auth Route Blocking**: Authenticated users redirected away from login/signup pages
- **Secure Headers**: `Secure`, `SameSite=Lax` cookie attributes in production
- **Session Validation**: Periodic checks to ensure token validity

### 🔄 Authentication Flow
1. **Login**: User submits credentials → Supabase validation → JWT token creation → Secure cookie storage
2. **Route Access**: Middleware intercepts requests → Token validation → Allow/redirect
3. **Token Refresh**: Automatic refresh every 50 minutes → New token → Updated cookie
4. **Session Check**: Periodic validation every 5 minutes → Logout if invalid
5. **Logout**: Clear server cookie → Clear client state → Redirect to login

### 📝 Database Structure
*Supabase auth configuration functional - no custom tables yet*

## 📊 Current Session Status
- ✅ **Authentication System**: Fully functional and production-ready
- ✅ **Token Management**: Modern JWT-based sessions implemented
- ✅ **Security**: Enterprise-level security measures in place
- ✅ **User Experience**: Seamless authentication with automatic session management
- ✅ **Error Handling**: Comprehensive error handling with French user messages
