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

### 📱 Clean Dashboard Interface (2025-09-14)
- **Sticky navbar** with app branding and hamburger menu button
- **Full-width slide-out menu panel** with smooth animations (300ms ease-in-out)
- **Menu panel features**: Right-to-left slide animation, overlay backdrop, close button
- **Group management navigation** renamed from "Paramètres" to "Gestion du groupe" with appropriate group icon
- **Logout functionality** moved to menu panel with red styling
- **Navigation footer** with personal and group finance buttons
- **Dynamic group name display** in footer showing actual group name instead of generic "Groupe"
- **Conditional UI** - group finance button only appears when user belongs to a group
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
- **Group members functionality** with detailed member list modal
- **Loading states** for all group operations with smooth animations
- **Enhanced profile API** with group information integration

### 👤 Group Members Management System (2025-09-14)
- **Complete members functionality** with "Voir membres" button implementation
- **GroupMembersModal component** with elegant modal design and responsive layout
- **useGroupMembers hook** for state management and API integration
- **Member list display** with avatars, names, and join dates
- **Creator identification** with distinctive badges for group creators
- **Generated avatars** with colorful gradient backgrounds using member initials
- **Loading states** with spinners and proper error handling
- **API security** ensuring only group members can view member lists
- **French localization** for all UI text and date formatting
- **Mobile-optimized** modal with proper touch interactions
- **Enhanced ProfileData interface** including group_id and group_name fields
- **Automatic group data fetching** with JOIN queries to groups table
- **Real-time member information** with proper data formatting and validation

### 💰 Salary and Contribution Management System (2025-09-14)
- **Salary management** with user-editable monthly salary in profile settings
- **Proportional contribution calculation** based on salary ratios within groups
- **Automatic recalculation** via PostgreSQL triggers when salaries change
- **ProfileSettingsCard component** with salary input and validation (1-999,999.99€)
- **UserContributionCard component** displaying personal contribution and percentage
- **GroupMembersWithContributionsModal** showing all members' contributions
- **useGroupContributions hook** for contribution state management and API calls
- **Smart calculation logic**: proportional when salaries defined, equal split otherwise
- **Real-time updates** when group members join/leave or change salaries
- **French currency formatting** and percentage display throughout the interface
- **Mobile-first responsive design** with loading states and error handling
- **Comprehensive documentation** in SALARY_CONTRIBUTION_SYSTEM.md

### 🔧 Enhanced Salary System & UI Improvements (2025-09-14 - Session Update)
- **Mandatory salary requirement** with validation preventing save if salary insufficient for calculated contribution
- **Smart contribution validation** with real-time calculation and blocking when contribution > salary
- **Detailed error messaging** with actionable suggestions (increase salary, reduce budget, wait for members)
- **Button disabling logic** preventing save when validation errors or contribution warnings present
- **Unified profile interface** moved from Settings page to Dashboard sidebar "Mon profil" section
- **Enhanced contribution display** showing both personal impact (% of salary) and group impact (% of budget)
- **PostgreSQL trigger fixes** for proper UUID handling and graceful group deletion
- **Next.js 15 compatibility** with proper async params handling in API routes
- **Database cleanup automation** with triggers removing orphaned contributions on group deletion
- **UI/UX refinements** with red asterisks for required fields and contextual validation messages

### 🎨 Dashboard Navbar Enhancement System (2025-09-14)
- **Complete navbar redesign** eliminating app branding to focus on user financial information
- **UserInfoNavbar component** with intelligent state management for different user contexts
- **UserAvatar component** featuring personalized initials with 8 distinct gradient color schemes
- **Two-line layout optimization** for mobile Pixel 3 format with proper text truncation
- **Contextual messaging system** explaining family contribution with group-specific information
- **Smart information hierarchy** prioritizing user greeting and financial contribution details
- **Automatic data integration** combining profile and contribution data for seamless display
- **Future-ready avatar system** prepared for image upload functionality
- **Responsive design patterns** with mobile-first approach and proper spacing optimization

### 💰 Financial Dashboard System (2025-09-14 - Latest)
- **FinancialIndicators component** with comprehensive financial status display system
- **Three-tier information architecture**: Available balance, remaining to live, total savings
- **Smart color coding system**: Green (positive), red (negative), gray (zero) with conditional styling
- **Mobile-optimized layout**: 2-column grid for main indicators, full-width savings element
- **Professional iconography**: Bank card, calculator, and information icons with consistent sizing
- **French currency formatting** with Intl.NumberFormat for proper euro display
- **Iterative design refinement** with multiple 15% size reductions for optimal mobile UX
- **Purple branding integration** for savings element matching application theme
- **Subtle background enhancement** with `bg-blue-50/50` for visual hierarchy
- **Future interaction ready** with hover states and cursor pointers for savings details
- **TypeScript interface** with `availableBalance`, `remainingToLive`, `totalSavings` props
- **Component documentation** with clear purpose and usage instructions

### 🏦 Complete Financial Management Database System (2025-09-14 - New)
- **5 New Financial Tables**: `estimated_incomes`, `real_income_entries`, `estimated_budgets`, `real_expenses`, `financial_snapshots`
- **Automatic Financial Calculations**: PostgreSQL functions implementing battleplan.txt logic
- **Cash Disponible Calculation**: `real_income - real_expenses` with database function `calculate_available_cash()`
- **Reste à Vivre Calculation**: `income - budgets - exceptional_expenses + savings` via `calculate_remaining_to_live()`
- **Budget Savings Auto-Update**: `MAX(0, estimated_amount - spent_this_month)` with triggers
- **XOR Ownership Constraints**: Each record belongs to either a profile OR a group (never both, never neither)
- **Comprehensive Logging System**: Operation tracking, performance monitoring, and error handling
- **Database Triggers**: Automatic recalculation of financial snapshots on data changes
- **Performance Optimization**: 20+ specialized indexes for fast financial queries
- **Data Integrity**: Business logic constraints, positive amounts, non-empty names
- **API Routes Integration**: Dashboard, income, budgets, expenses routes with database functions
- **Real-time Updates**: Financial snapshots updated automatically when any financial data changes
- **Migration Scripts**: Safe database migration with constraint conflict resolution

### 💰 Complete Financial Planning System (2025-09-14 - New)
- **Interactive Planning Drawer**: Full-screen bottom-to-top drawer with smooth animations
- **Dual-Tab Interface**: Separate tabs for estimated budgets (orange theme) and incomes (green theme)
- **Smart Budget Validation**: Real-time balance checking prevents negative balances with detailed feedback
- **Income Management**: Simple income creation with live total calculation showing current + new amounts
- **Database Persistence**: Full CRUD operations via custom hooks (`useBudgets`, `useIncomes`) 
- **API Integration**: Secure REST endpoints (`/api/budgets`, `/api/incomes`) with JWT authentication
- **Real-time Updates**: Automatic data refresh when drawer opens, immediate UI updates after operations
- **Visual Feedback**: Discrete totals at tab tops, color-coded balance indicators, loading states
- **Delete Functionality**: One-click deletion with confirmation for both budgets and incomes
- **Error Handling**: Comprehensive error management with detailed logging and user-friendly messages
- **Mobile-First Design**: Optimized for mobile with touch-friendly interactions and responsive layouts
- **Balance Calculations**: Dynamic footer showing real-time difference between total incomes and budgets
- **Detailed Documentation**: Complete system documentation in `/docs/FINANCIAL_PLANNING_SYSTEM.md`

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
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  group_id uuid,
  salary numeric DEFAULT 0,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
```

**Table Purpose**: Extended user profile information with single group membership and salary management
- **Primary Key**: `id` (UUID) - Links directly to `auth.users(id)`
- **Required Fields**: `first_name`, `last_name` - User's full name
- **Salary Field**: `salary` (NUMERIC) - Monthly salary in euros, defaults to 0
- **Group Relationship**: `group_id` - Links to single group (nullable)
- **Timestamps**: Automatic `created_at` and `updated_at` tracking
- **Constraint**: One user can belong to maximum one group

**`public.groups`**
```sql
CREATE TABLE public.groups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  monthly_budget_estimate numeric NOT NULL,
  creator_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT groups_pkey PRIMARY KEY (id),
  CONSTRAINT groups_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES auth.users(id)
);
```

**Table Purpose**: Groups for budget management and collaboration
- **Primary Key**: `id` (UUID) - Unique group identifier
- **Required Fields**: `name` (unique), `monthly_budget_estimate`, `creator_id`
- **Foreign Key**: `creator_id` links to `auth.users(id)`
- **Auto-update**: `updated_at` trigger for modifications
- **RLS**: Row-level security enabled with creator-based permissions

**`public.group_contributions`**
```sql
CREATE TABLE public.group_contributions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  group_id uuid NOT NULL,
  salary numeric NOT NULL CHECK (salary >= 0::numeric),
  contribution_amount numeric NOT NULL CHECK (contribution_amount >= 0::numeric),
  contribution_percentage numeric NOT NULL CHECK (contribution_percentage >= 0::numeric),
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT group_contributions_pkey PRIMARY KEY (id),
  CONSTRAINT group_contributions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id),
  CONSTRAINT group_contributions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);
```

**Table Purpose**: Stores calculated proportional contributions for each user in a group
- **Primary Key**: `id` (UUID) - Unique contribution record identifier
- **Required Fields**: `profile_id`, `group_id`, `salary`, `contribution_amount`, `contribution_percentage`
- **Foreign Keys**: Links to both `profiles(id)` and `groups(id)` tables
- **Salary Snapshot**: `salary` field captures user's salary when contribution was calculated
- **Calculated Values**: `contribution_amount` (euros), `contribution_percentage` (% of personal salary)
- **Constraints**: All numeric values must be >= 0, unique constraint per (profile_id, group_id)
- **Auto-calculation**: Updated automatically via PostgreSQL triggers when salaries or group budgets change
- **Cleanup**: Records automatically deleted when profile leaves group or group is deleted

**Note**: The `group_members` table has been removed in favor of direct relationship via `profiles.group_id`.

**`public.estimated_incomes`**
```sql
CREATE TABLE public.estimated_incomes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  name text NOT NULL,
  estimated_amount numeric NOT NULL CHECK (estimated_amount >= 0),
  is_monthly_recurring boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT estimated_incomes_pkey PRIMARY KEY (id),
  CONSTRAINT estimated_incomes_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR 
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);
```

**Table Purpose**: Estimated income sources for financial planning
- **XOR Ownership**: Each record belongs to either a profile OR a group (never both)
- **Required Fields**: `name`, `estimated_amount` (≥ 0), `is_monthly_recurring`
- **Automatic Timestamps**: `created_at`, `updated_at` with triggers
- **Business Logic**: Name cannot be empty, amounts must be non-negative

**`public.real_income_entries`**
```sql
CREATE TABLE public.real_income_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  estimated_income_id uuid,
  amount numeric NOT NULL CHECK (amount > 0),
  description text,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  is_exceptional boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT real_income_entries_pkey PRIMARY KEY (id),
  CONSTRAINT real_income_entries_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR 
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);
```

**Table Purpose**: Actual income entries for cash calculations
- **Required**: Positive `amount`, `entry_date`
- **Optional Link**: `estimated_income_id` (NULL for exceptional income)
- **Automatic Triggers**: Updates financial snapshots on changes

**`public.estimated_budgets`**
```sql
CREATE TABLE public.estimated_budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  name text NOT NULL,
  estimated_amount numeric NOT NULL CHECK (estimated_amount >= 0),
  current_savings numeric NOT NULL DEFAULT 0 CHECK (current_savings >= 0),
  is_monthly_recurring boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT estimated_budgets_pkey PRIMARY KEY (id),
  CONSTRAINT estimated_budgets_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR 
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);
```

**Table Purpose**: Budget categories with automatic savings calculation
- **Auto-calculated**: `current_savings = MAX(0, estimated_amount - spent_this_month)`
- **Updated By**: Triggers when expenses change

**`public.real_expenses`**
```sql
CREATE TABLE public.real_expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  estimated_budget_id uuid,
  amount numeric NOT NULL CHECK (amount > 0),
  description text,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  is_exceptional boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT real_expenses_pkey PRIMARY KEY (id),
  CONSTRAINT real_expenses_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR 
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);
```

**Table Purpose**: Actual expenses with budget tracking
- **Optional Link**: `estimated_budget_id` (NULL for exceptional expenses)
- **Automatic Triggers**: Updates budget savings and financial snapshots

**`public.financial_snapshots`**
```sql
CREATE TABLE public.financial_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  available_cash numeric NOT NULL DEFAULT 0,
  remaining_to_live numeric NOT NULL DEFAULT 0,
  total_savings numeric NOT NULL DEFAULT 0,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT financial_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT financial_snapshots_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR 
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);
```

**Table Purpose**: Cached financial calculations for performance
- **Auto-updated**: By triggers when any financial data changes
- **Unique Current**: Only one `is_current = true` per owner
- **Calculations**: Uses database functions from battleplan.txt logic

## 📊 Current Session Status (Updated 2025-09-14 - Final)
- ✅ **Authentication System**: Fully functional and production-ready
- ✅ **Token Management**: Modern JWT-based sessions implemented
- ✅ **Security**: Enterprise-level security measures in place
- ✅ **User Experience**: Seamless authentication with automatic session management
- ✅ **Error Handling**: Comprehensive error handling with French user messages
- ✅ **Single-Group System**: Simplified one-group-per-user system with full management capabilities
- ✅ **Group Members Management**: Complete implementation with modal display and member listing
- ✅ **Navigation Enhancement**: Footer navigation with dynamic group names and menu improvements
- ✅ **Loading States**: Comprehensive loading animations for all group operations
- ✅ **Profile Enhancement**: Extended profile data with group information integration
- ✅ **Mandatory Salary System**: Salary-centric application with intelligent contribution validation
- ✅ **Advanced UI/UX**: Unified profile interface in dashboard sidebar with enhanced contribution display
- ✅ **PostgreSQL Robustness**: Triggers, cleanup automation, and Next.js 15 compatibility
- ✅ **Complete Financial Backend**: 5 tables, automatic calculations, triggers, and performance indexes
- ✅ **API Routes**: Full CRUD operations for income, budgets, expenses with database integration
- ✅ **Battleplan Implementation**: All financial calculations from battleplan.txt automated in PostgreSQL
- ✅ **Migration Scripts**: Safe database deployment with constraint conflict resolution
- ✅ **Comprehensive Logging**: Operation tracking, error handling, and performance monitoring
- ✅ **Database Functions**: `calculate_available_cash()`, `calculate_remaining_to_live()`, budget savings automation
