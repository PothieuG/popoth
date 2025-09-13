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
- **Rationale**: Code maintainability, international collaboration, technical standards

### 📚 Documentation & Research
- **CRITICAL**: Always use "use context7" in prompts before implementing features
- Always verify latest documentation for Next.js, React, TypeScript, Tailwind, shadcn/ui
- Check for breaking changes and best practices updates
- Update this CLAUDE.md when adopting new technologies or major features

### 🛠️ Development Workflow
- **Package Manager**: pnpm ONLY
- **Local server**: Never lauch pnpm dev, or ask for it.
- **Code Quality**: Run lint + typecheck after major changes
- **Error Handling**: Fix warnings/errors immediately when running the app
- **Factorization**: Always look for reusable patterns and components
- **Loading States**: Add smooth loading animations for all data fetching
- **Documentation**: Each time ou create a function, I want you to document it and explain what it doest just above it
- **Code Quality**: Focus on clean, well-documented code without automated testing
- **Style**: I want consistency in the style and the theme of the application
- **Error handling**: Every time your are using an API or fetching data, implement a try/catch 

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

- **IMPORTANT**: Always log development progress for session continuity
- Use `logs/CURRENT_SESSION.md` for active session tracking (keep under 1000 lines)
- Archive completed sessions to `logs/dev-log-YYYY-MM.md` monthly
- When CURRENT_SESSION.md gets large (>50KB), archive and start fresh
- Always read CURRENT_SESSION.md at start of new sessions to understand project state
- Log major decisions, architecture changes, completed features, and next steps

### 🎯 Current Tech Stack (Updated)
- **Frontend**: Next.js 15.5.3 with App Router
- **Language**: TypeScript 5.x (ES2022 target)
- **Styling**: Tailwind CSS 3.4.x
- **UI Components**: shadcn/ui (latest)
- **Backend**: Supabase (Auth + Database) - pending setup
- **Package Manager**: pnpm
- **Linting**: ESLint 9.x (flat config)

### 📝 Database Structure
*To be documented when Supabase is configured*
