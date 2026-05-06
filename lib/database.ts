import type { Database as Generated } from './database.types'

// Augments the generated Database with the 4 atomic finance RPCs from
// supabase/migrations/20260506000000_create_finance_rpcs.sql. Those RPCs are
// GRANT EXECUTE TO service_role only, so PostgREST never exposes them and
// `pnpm db:types` cannot include them. Both helpers call .rpc() through the
// service-role client (lib/supabase-server.ts), so the augmentation lives at
// the type level here. Re-running `pnpm db:types` regenerates database.types.ts
// without touching this file.
export type Database = Generated & {
  public: {
    Functions: {
      update_piggy_bank_amount: {
        Args: {
          p_delta: number
          p_profile_id?: string | null
          p_group_id?: string | null
        }
        Returns: number
      }
      update_bank_balance: {
        Args: {
          p_delta: number
          p_profile_id?: string | null
          p_group_id?: string | null
        }
        Returns: number
      }
      update_budget_cumulated_savings: {
        Args: {
          p_budget_id: string
          p_delta: number
        }
        Returns: number
      }
      transfer_from_piggy_to_budget: {
        Args: {
          p_amount: number
          p_budget_id: string
          p_profile_id?: string | null
          p_group_id?: string | null
        }
        Returns: { piggy_bank: number; cumulated_savings: number }
      }
    }
  }
}
