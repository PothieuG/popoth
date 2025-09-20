# Developed Features

## 🚀 Authentication System

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

## 🎨 Design & Interface

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

### 🎨 Complete Avatar System with Personal Photos (2025-09-18 - NEW)
- **Personal Photo Upload**: Full image upload system in profile settings with drag-and-drop support
- **Smart Avatar Management**: Upload, change, and delete personal photos with intelligent fallback to initials
- **Multi-format Support**: Accepts all image formats (JPG, PNG, GIF, etc.) with 5MB size limit
- **Base64 Storage**: Simplified storage using data URLs, no external file hosting required
- **Intelligent Fallback**: Automatic fallback to colorful initials when no photo or load error
- **Universal Integration**: Personal avatars displayed throughout the application (navbar, transactions, profiles)
- **Perfect Alignment**: Corrected vertical alignment in transaction lists for professional appearance
- **Force Refresh System**: Automatic page reload after avatar changes to ensure immediate visual updates
- **Error Handling**: Robust error handling with graceful degradation and user feedback
- **Mobile-First Design**: Optimized for mobile with touch-friendly upload interface

## 👥 Group Management

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

## 💰 Financial System

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

### 💰 Application-Side Financial Calculation System (2025-09-15 - Migrated)
- **4 Core Financial Tables**: `estimated_incomes`, `real_income_entries`, `estimated_budgets`, `real_expenses`
- **Application-Side Calculations**: Modern TypeScript library implementing battleplan.txt business rules
- **Financial Calculations Library**: `lib/financial-calculations.ts` with pure functions for all financial logic
- **Cash Disponible Logic**: `calculateAvailableCash(realIncomes, realExpenses)` - real money on account
- **Reste à Vivre Logic**: `calculateRemainingToLiveProfile()` and `calculateRemainingToLiveGroup()` variants
- **Budget Savings Logic**: `calculateBudgetSavings()` with MAX(0, estimated - spent) formula
- **XOR Ownership Constraints**: Each record belongs to either a profile OR a group (never both, never neither)
- **Smart Caching System**: 5-minute in-memory cache in `/api/financial/dashboard` for performance
- **Automatic Cache Invalidation**: Cache cleared on any budget/income/expense modifications
- **Data Retrieval Functions**: `getProfileFinancialData()` and `getGroupFinancialData()` with complete data aggregation
- **Performance Optimization**: Efficient Supabase queries with JOIN operations and data aggregation
- **Error Resilience**: Comprehensive try/catch with fallback values and detailed logging
- **Real-time Dashboard**: Live financial data connected to dashboard with loading states
- **API Routes Integration**: Clean REST endpoints with intelligent caching and invalidation hooks
- **Migration Complete**: Successfully migrated from unreliable PostgreSQL triggers to stable application logic

### 💰 Dual-Context Financial System (2025-09-15 - Complete Independence)
- **Profile-Group Separation**: Complete independence between personal and group finances
- **Editable Bank Balance**: Both profiles and groups have separate, editable bank balances
- **XOR Ownership Pattern**: All financial tables use profile_id XOR group_id constraint
- **Context-Based APIs**: All endpoints support `?context=profile|group` parameter
- **Group Dashboard**: Complete group financial dashboard at `/group-dashboard` with GroupInfoNavbar
- **Independent Calculations**: Groups have their own income, budgets, and savings calculations
- **Smart Caching System**: 5-minute cache with context-aware invalidation
- **Database Migration**: Extended `bank_balances` table with partial unique indexes for groups
- **API Security**: RLS policies ensuring proper access control for both contexts
- **Real-time Synchronization**: Automatic cache refresh across both profile and group contexts

### 💰 Complete Financial Planning System (2025-09-14 - Enhanced)
- **Interactive Planning Drawer**: Full-screen bottom-to-top drawer with smooth animations
- **Dual-Tab Interface**: Separate tabs for estimated budgets (orange theme) and incomes (green theme)
- **Smart Budget Validation**: Real-time balance checking prevents negative balances with detailed feedback
- **Income Management**: Simple income creation with live total calculation showing current + new amounts
- **Database Persistence**: Full CRUD operations via custom hooks (`useBudgets`, `useIncomes`)
- **API Integration**: Secure REST endpoints (`/api/budgets`, `/api/incomes`) with JWT authentication
- **Real-time Updates**: Automatic data refresh when drawer opens, immediate UI updates after operations
- **Visual Feedback**: Discrete totals at tab tops, color-coded balance indicators, loading states
- **Enhanced CRUD Operations**: Full create, read, update, delete functionality for both budgets and incomes
- **Edit/Delete Interface**: 3-dot dropdown menus with edit modals and delete confirmation dialogs
- **Smart Edit Modals**: Real-time validation showing financial impact preview during editing
- **Confirmation System**: Delete confirmation dialogs with item-specific messaging
- **Error Handling**: Comprehensive error management with detailed logging and user-friendly messages
- **Mobile-First Design**: Optimized for mobile with touch-friendly interactions and responsive layouts
- **Balance Calculations**: Dynamic footer showing real-time difference between total incomes and budgets
- **Cache Invalidation**: Automatic financial cache refresh after all CRUD operations

### 💳 Complete Real Transaction Management System (2025-09-15 - NEW)
- **Dual Transaction Types**: Complete expense and income entry system with exceptional/budgeted categorization
- **Real-time Transaction Tracking**: Live transaction lists with sorting by date (most recent first)
- **XOR Database Integration**: Full integration with existing `real_expenses` and `real_income_entries` tables
- **Context-Aware Operations**: Complete support for both profile and group transaction management
- **Smart Categorization System**: Automatic distinction between exceptional and budgeted/estimated transactions
- **Advanced CRUD Operations**: Full create, read, update, delete functionality with real-time cache invalidation
- **Intelligent Modal System**: Adaptive transaction creation modal with context-sensitive forms
- **Mobile-Optimized Interface**: Three-tab footer navigation with prominent add transaction functionality
- **Transaction List Display**: 3-line layout showing description, category, and timestamp with proper color coding
- **Professional UX Design**: Consistent iconography, subtle backgrounds, and optimized spacing throughout

## 🏗️ Authentication System Architecture

### 📁 File Structure
```
├── middleware.ts                        # Route protection and token validation
├── lib/
│   ├── session.ts                      # JWT token utilities (client/server agnostic)
│   ├── session-server.ts               # Server-side session management
│   ├── session-client.ts               # Client-side session utilities
│   ├── auth.ts                         # Authentication API functions
│   └── financial-calculations.ts       # Financial calculation library (battleplan.txt rules)
├── contexts/
│   └── AuthContext.tsx                 # React Context for global auth state
├── hooks/
│   ├── useAuth.ts                      # Custom authentication hooks
│   ├── useFinancialData.ts             # Financial data management with caching
│   ├── useBudgets.ts                   # Budget CRUD operations with cache invalidation
│   ├── useIncomes.ts                   # Income CRUD operations with cache invalidation
│   ├── useBankBalance.ts               # Bank balance management with error handling
│   ├── useRealExpenses.ts              # Real expense CRUD operations with context support
│   └── useRealIncomes.ts               # Real income CRUD operations with context support
├── components/
│   ├── ui/
│   │   ├── DropdownMenu.tsx            # Reusable 3-dot dropdown menu component
│   │   ├── ConfirmationDialog.tsx      # Delete confirmation modal dialog
│   │   ├── UserAvatar.tsx              # Smart avatar component with photo/initials fallback
│   │   └── AvatarUpload.tsx            # Avatar upload component with file validation
│   └── dashboard/
│       ├── EditBudgetDialog.tsx        # Budget editing modal with validation
│       ├── EditIncomeDialog.tsx        # Income editing modal with validation
│       ├── EditableBalanceLine.tsx     # Bank balance line with pencil edit icon
│       ├── EditBalanceModal.tsx        # Bank balance editing modal with explanations
│       ├── AddTransactionModal.tsx     # Unified transaction creation modal (expenses/incomes)
│       ├── TransactionTabsComponent.tsx # Main transaction tabs interface with lists
│       └── TransactionListItem.tsx     # Individual transaction display component
├── app/
│   ├── api/
│   │   ├── auth/session/route.ts       # Authentication API endpoint
│   │   ├── financial/dashboard/route.ts # Financial data API with smart caching
│   │   ├── budgets/route.ts            # Budget CRUD API endpoints
│   │   ├── incomes/route.ts            # Income CRUD API endpoints
│   │   ├── bank-balance/route.ts       # Bank balance GET/POST API endpoints
│   │   └── finances/
│   │       ├── expenses/real/route.ts  # Real expenses CRUD API with context support
│   │       └── income/real/route.ts    # Real income entries CRUD API with context support
│   ├── layout.tsx                      # AuthProvider wrapper
│   ├── connexion/page.tsx              # Login page
│   ├── inscription/page.tsx            # Registration page
│   ├── dashboard/page.tsx              # Protected dashboard with transaction management
│   └── group-dashboard/page.tsx        # Group dashboard with transaction management
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