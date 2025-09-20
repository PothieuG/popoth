# Popoth_App_Claude

## Project Overview
A modern web application built with Next.js 15, TypeScript, shadcn/ui, and Supabase. Enhanced with Context7 MCP Server for real-time documentation during development.
The application is only for mobile, but could be used in desktop. Desktop beautiful UI and UX is not the priority.

## Documentation Structure

This project documentation is organized into focused files for better maintainability:

- **[DEVELOPMENT_GUIDELINES.md](./DEVELOPMENT_GUIDELINES.md)** - Claude instructions, workflow rules, and development standards
- **[TECH_STACK.md](./TECH_STACK.md)** - Technical stack details, MCP server configuration, and environment setup
- **[FEATURES.md](./FEATURES.md)** - Complete list of developed features with technical architecture
- **[DATABASE.md](./DATABASE.md)** - Database schema, table structures, and relationships
- **[SESSION_STATUS.md](./SESSION_STATUS.md)** - Current project status, achievements, and system readiness

## Quick Reference

### Tech Stack Summary
- **Frontend**: Next.js 15.5.3 with App Router
- **Language**: TypeScript 5.x (ES2022 target)
- **Styling**: Tailwind CSS 3.4.x
- **UI Components**: shadcn/ui (latest)
- **Backend**: Supabase (Auth + Database) - ✅ configured and functional
- **Package Manager**: pnpm
- **Development Aid**: Context7 MCP Server

### Key Development Rules
- **Language**: ALL code, comments, documentation MUST be in English
- **UI Language**: French for end users only
- **Package Manager**: pnpm ONLY
- **Mobile-First**: Primary target is mobile devices
- **Never Auto-Run**: Do NOT run dev/build commands automatically

### Current System Status
✅ **Production Ready**: Authentication, group management, financial system, avatar system
✅ **Complete Feature Set**: All core functionality implemented and tested
✅ **Database Optimized**: Application-side calculations with smart caching
✅ **Security Hardened**: Enterprise-level JWT authentication and RLS policies

For detailed information on any aspect of the project, refer to the specific documentation files above.