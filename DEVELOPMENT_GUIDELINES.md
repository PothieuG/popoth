# Development Guidelines

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

## Important Instruction Reminders
- Do what has been asked; nothing more, nothing less.
- NEVER create files unless they're absolutely necessary for achieving your goal.
- ALWAYS prefer editing an existing file to creating a new one.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.