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
This project uses multiple MCP servers for enhanced AI-assisted development and testing.

### Context7 Setup
- **MCP Server**: Context7 (@upstash/context7-mcp)
- **Purpose**: Provides up-to-date documentation and code examples
- **Usage**: Add "use context7" to prompts for enhanced documentation access

### Playwright MCP Setup
- **MCP Server**: Microsoft Playwright MCP (@playwright/mcp)
- **Purpose**: Enables automated browser testing and interaction
- **Usage**: Claude can now run tests and interact with the application directly
- **Features**: Take screenshots, navigate pages, fill forms, click elements

## Custom Instructions for Claude
- The code and documentation will be in english but the application is french
- If you think it's relevant, add any important information to the Claude.md file to give more context. For example, it's when we are using a new tech stack, or when an important feature has been developed...
- **DOCUMENTATION**: Always use context7 MCP integration to get up-to-date documentation for any library or framework before implementing features
- Always check and reference the latest official documentation for all technologies used
- Verify current best practices and API changes before implementing features
- For Next.js: Use context7 to get latest App Router conventions and features
- For shadcn/ui: Use context7 to verify component APIs and installation methods
- For PWA: Use context7 to reference current service worker and manifest standards
- For TailwindCSS: Use context7 for latest utility classes and configuration options
- Always use the most up-to-date syntax and patterns from context7 documentation
- Use pnpm as the package manager for this project
- **IMPORTANT**: Always log development progress for session continuity
- Use `logs/CURRENT_SESSION.md` for active session tracking (keep under 1000 lines)
- Archive completed sessions to `logs/dev-log-YYYY-MM.md` monthly
- When CURRENT_SESSION.md gets large (>50KB), archive and start fresh
- Always read CURRENT_SESSION.md at start of new sessions to understand project state
- Log major decisions, architecture changes, completed features, and next steps
- Always try to factorize when you can
- Ask me something if you need more information about something I told you
- If you are implementing something that fetch data, always add a smooth loading animation somewhere relevant such a a simple "Loading..." text or better a small animated icon from a library.
- When you are running the app, if there are some warning or error, fix them straight away.
- If you are implementing something related to Supabase, and you need me to do something in the Supabase dashboard, please guide me the best you can.
- If you get any information about the db structure, please document it here

## Project Status
### ✅ Initial Setup Complete (2025-09-13)
- Next.js 15 project initialized with TypeScript
- Tailwind CSS configured with custom color variables  
- shadcn/ui installed with button and card components
- Supabase client setup ready (awaiting environment variables)
- Modern homepage with feature showcase created
- Development server running on http://localhost:3001

### Next Steps
- Configure Supabase project and add environment variables
- Setup authentication system
- Add mobile-first responsive design optimizations
- Install Context7 and Playwright MCP servers
