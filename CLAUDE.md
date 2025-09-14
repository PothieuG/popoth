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

### 📊 Session Logging & Continuity System
- **Progress Updates**: Update this CLAUDE.md with major milestones
- **Architecture Decisions**: Document significant technical choices
- **Feature Completion**: Mark features as ✅ complete with brief description
- **Next Steps**: Always maintain clear next actions list

### 🗂️ Advanced Session Management (Updated 2025-09-14)
- **CRITICAL**: Always log development progress for session continuity and update CLAUDE.md
- **MANDATORY**: Use `logs/CURRENT_SESSION.md` for active session tracking
- **AUTOMATIC ARCHIVING**: At start of each new day, archive previous `CURRENT_SESSION.md` as `dev-session-YYYY-MM-DD.md`
- **NEW SESSION PROTOCOL**:
  1. Archive previous `CURRENT_SESSION.md` with date format: `dev-session-YYYY-MM-DD.md`
  2. Create fresh `CURRENT_SESSION.md` with context summary from previous session
  3. Include system status and capabilities for quick context
  4. Define new session objectives based on user priorities

### 📚 Session Continuity Protocol
- **ESSENTIAL ON /reset**: ALWAYS start new conversations by reading `logs/CURRENT_SESSION.md` first
  - If CURRENT_SESSION.md doesn't exist, read the most recent `logs/dev-session-YYYY-MM-DD.md`
  - This ensures complete context continuity after conversation resets
  - Do this BEFORE asking what the user wants to work on
- **Archive Management**: Keep daily session archives for historical reference
- **Size Management**: When CURRENT_SESSION.md gets large (>50KB), archive and start fresh
- **Context Preservation**: Always include previous session achievements in new session header
- **System Status**: Maintain current system capabilities summary for quick context

### 🤝 Collaboration
- **Questions**: Ask for clarification when requirements are unclear
- **Confirmation**: Confirm approach for complex implementations
- **Guidance**: Request Supabase dashboard steps when backend changes needed
- **Session Management**: User can request session archiving and new session creation at any time

### 📝 Logging Best Practices
- **Daily Sessions**: Each day gets its own session file for clear organization
- **Contextual Continuity**: New sessions include summary of previous achievements
- **Status Tracking**: Maintain clear system status for quick context switching
- **Historical Reference**: Archived sessions provide development timeline and decisions
- **Problem Resolution**: Documented issues and solutions for future reference

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
- **Settings navigation** with gear icon and direct link to `/settings`
- **Logout functionality** moved to menu panel with red styling
- **Sticky footer** ready for future content
- **Clean main content area** prepared for feature development
- **Smooth transitions** for all panel interactions using Tailwind CSS transforms

### 👥 Single-Group Management System (2025-09-14)
- **One group per user** constraint enforced at database and application level
- **Group creation** with name validation and budget estimation
- **Direct relationship** via `profiles.group_id` foreign key (simplified architecture)
- **Secure group management** with creator-only deletion rights
- **Group search and discovery** only available to users without a group
- **Automatic membership management** - join/leave updates profile directly
- **Settings page** (`/settings`) with single group interface and state management
- **Secure deletion modal** requiring "Delete [group_name]" confirmation
- **Leave group functionality** for non-creators with profile cleanup
- **Budget tracking** with monthly estimates for financial planning
- **Smart UI** that hides/shows sections based on user's group status
- **RLS security policies** ensuring proper data access control
- **Responsive design** optimized for mobile-first usage

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

#### 🗄️ Supabase Tables

**`public.profiles`**
```sql
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  group_id uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
```

**Table Purpose**: Extended user profile information with single group membership
- **Primary Key**: `id` (UUID) - Links directly to `auth.users(id)`
- **Required Fields**: `first_name`, `last_name` - User's full name
- **Group Relationship**: `group_id` - Links to single group (nullable)
- **Timestamps**: Automatic `created_at` and `updated_at` tracking
- **Constraint**: One user can belong to maximum one group

**`public.groups`**
```sql
CREATE TABLE public.groups (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  monthly_budget_estimate DECIMAL(10,2) NOT NULL,
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT groups_pkey PRIMARY KEY (id)
);
```

**Table Purpose**: Groups for budget management and collaboration
- **Primary Key**: `id` (UUID) - Unique group identifier
- **Required Fields**: `name` (unique), `monthly_budget_estimate`, `creator_id`
- **Foreign Key**: `creator_id` links to `auth.users(id)`
- **Auto-update**: `updated_at` trigger for modifications
- **RLS**: Row-level security enabled with creator-based permissions

**Note**: The `group_members` table has been removed in favor of direct relationship via `profiles.group_id`.

## 📊 Current Session Status
- ✅ **Authentication System**: Fully functional and production-ready
- ✅ **Token Management**: Modern JWT-based sessions implemented
- ✅ **Security**: Enterprise-level security measures in place
- ✅ **User Experience**: Seamless authentication with automatic session management
- ✅ **Error Handling**: Comprehensive error handling with French user messages
- ✅ **Single-Group System**: Simplified one-group-per-user system with full management capabilities
