export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bank_balances: {
        Row: {
          balance: number
          created_at: string | null
          current_remaining_to_live: number | null
          group_id: string | null
          id: string
          profile_id: string | null
          updated_at: string | null
        }
        Insert: {
          balance?: number
          created_at?: string | null
          current_remaining_to_live?: number | null
          group_id?: string | null
          id?: string
          profile_id?: string | null
          updated_at?: string | null
        }
        Update: {
          balance?: number
          created_at?: string | null
          current_remaining_to_live?: number | null
          group_id?: string | null
          id?: string
          profile_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_balances_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_transfers: {
        Row: {
          created_at: string | null
          from_budget_id: string | null
          group_id: string | null
          id: string
          profile_id: string | null
          to_budget_id: string
          transfer_amount: number
          transfer_date: string
          transfer_reason: string | null
        }
        Insert: {
          created_at?: string | null
          from_budget_id?: string | null
          group_id?: string | null
          id?: string
          profile_id?: string | null
          to_budget_id: string
          transfer_amount: number
          transfer_date?: string
          transfer_reason?: string | null
        }
        Update: {
          created_at?: string | null
          from_budget_id?: string | null
          group_id?: string | null
          id?: string
          profile_id?: string | null
          to_budget_id?: string
          transfer_amount?: number
          transfer_date?: string
          transfer_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_transfers_from_budget_fkey"
            columns: ["from_budget_id"]
            isOneToOne: false
            referencedRelation: "estimated_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_transfers_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_transfers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_transfers_to_budget_fkey"
            columns: ["to_budget_id"]
            isOneToOne: false
            referencedRelation: "estimated_budgets"
            referencedColumns: ["id"]
          },
        ]
      }
      estimated_budgets: {
        Row: {
          carryover_applied_date: string | null
          carryover_spent_amount: number | null
          created_at: string | null
          cumulated_savings: number | null
          estimated_amount: number
          group_id: string | null
          id: string
          is_monthly_recurring: boolean
          last_monthly_update: string | null
          last_savings_update: string | null
          last_surplus_transfer_date: string | null
          monthly_deficit: number | null
          monthly_surplus: number | null
          name: string
          profile_id: string | null
          updated_at: string | null
        }
        Insert: {
          carryover_applied_date?: string | null
          carryover_spent_amount?: number | null
          created_at?: string | null
          cumulated_savings?: number | null
          estimated_amount: number
          group_id?: string | null
          id?: string
          is_monthly_recurring?: boolean
          last_monthly_update?: string | null
          last_savings_update?: string | null
          last_surplus_transfer_date?: string | null
          monthly_deficit?: number | null
          monthly_surplus?: number | null
          name: string
          profile_id?: string | null
          updated_at?: string | null
        }
        Update: {
          carryover_applied_date?: string | null
          carryover_spent_amount?: number | null
          created_at?: string | null
          cumulated_savings?: number | null
          estimated_amount?: number
          group_id?: string | null
          id?: string
          is_monthly_recurring?: boolean
          last_monthly_update?: string | null
          last_savings_update?: string | null
          last_surplus_transfer_date?: string | null
          monthly_deficit?: number | null
          monthly_surplus?: number | null
          name?: string
          profile_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimated_budgets_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimated_budgets_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      estimated_incomes: {
        Row: {
          created_at: string | null
          estimated_amount: number
          group_id: string | null
          id: string
          is_monthly_recurring: boolean
          name: string
          profile_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          estimated_amount: number
          group_id?: string | null
          id?: string
          is_monthly_recurring?: boolean
          name: string
          profile_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          estimated_amount?: number
          group_id?: string | null
          id?: string
          is_monthly_recurring?: boolean
          name?: string
          profile_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimated_incomes_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimated_incomes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_contributions: {
        Row: {
          calculated_at: string | null
          contribution_amount: number
          contribution_percentage: number
          group_id: string
          id: string
          profile_id: string
          salary: number
        }
        Insert: {
          calculated_at?: string | null
          contribution_amount: number
          contribution_percentage: number
          group_id: string
          id?: string
          profile_id: string
          salary: number
        }
        Update: {
          calculated_at?: string | null
          contribution_amount?: number
          contribution_percentage?: number
          group_id?: string
          id?: string
          profile_id?: string
          salary?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_contributions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_contributions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string | null
          creator_id: string
          id: string
          monthly_budget_estimate: number
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          creator_id: string
          id?: string
          monthly_budget_estimate: number
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          creator_id?: string
          id?: string
          monthly_budget_estimate?: number
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      monthly_recaps: {
        Row: {
          budget_snapshot_data: Json
          completed_at: string | null
          created_at: string
          current_step: string
          group_id: string | null
          id: string
          profile_id: string | null
          recap_month: number
          recap_year: number
          refloated_from_piggy: number
          refloated_from_savings: number
          started_at: string | null
          started_by_profile_id: string | null
          updated_at: string
        }
        Insert: {
          budget_snapshot_data?: Json
          completed_at?: string | null
          created_at?: string
          current_step?: string
          group_id?: string | null
          id?: string
          profile_id?: string | null
          recap_month: number
          recap_year: number
          refloated_from_piggy?: number
          refloated_from_savings?: number
          started_at?: string | null
          started_by_profile_id?: string | null
          updated_at?: string
        }
        Update: {
          budget_snapshot_data?: Json
          completed_at?: string | null
          created_at?: string
          current_step?: string
          group_id?: string | null
          id?: string
          profile_id?: string | null
          recap_month?: number
          recap_year?: number
          refloated_from_piggy?: number
          refloated_from_savings?: number
          started_at?: string | null
          started_by_profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_recaps_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_recaps_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_recaps_started_by_profile_id_fkey"
            columns: ["started_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      piggy_bank: {
        Row: {
          amount: number
          group_id: string | null
          id: string
          last_updated: string | null
          profile_id: string | null
        }
        Insert: {
          amount?: number
          group_id?: string | null
          id?: string
          last_updated?: string | null
          profile_id?: string | null
        }
        Update: {
          amount?: number
          group_id?: string | null
          id?: string
          last_updated?: string | null
          profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "piggy_bank_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piggy_bank_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          first_name: string
          group_id: string | null
          id: string
          last_name: string
          salary: number | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          first_name: string
          group_id?: string | null
          id: string
          last_name: string
          salary?: number | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          first_name?: string
          group_id?: string | null
          id?: string
          last_name?: string
          salary?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      real_expenses: {
        Row: {
          amount: number
          amount_from_budget: number | null
          amount_from_budget_savings: number | null
          amount_from_piggy_bank: number | null
          applied_to_balance_at: string | null
          carried_from_recap_id: string | null
          created_at: string | null
          created_by_profile_id: string | null
          description: string
          estimated_budget_id: string | null
          expense_date: string
          group_id: string | null
          id: string
          is_carried_over: boolean
          is_exceptional: boolean
          profile_id: string | null
        }
        Insert: {
          amount: number
          amount_from_budget?: number | null
          amount_from_budget_savings?: number | null
          amount_from_piggy_bank?: number | null
          applied_to_balance_at?: string | null
          carried_from_recap_id?: string | null
          created_at?: string | null
          created_by_profile_id?: string | null
          description: string
          estimated_budget_id?: string | null
          expense_date?: string
          group_id?: string | null
          id?: string
          is_carried_over?: boolean
          is_exceptional?: boolean
          profile_id?: string | null
        }
        Update: {
          amount?: number
          amount_from_budget?: number | null
          amount_from_budget_savings?: number | null
          amount_from_piggy_bank?: number | null
          applied_to_balance_at?: string | null
          carried_from_recap_id?: string | null
          created_at?: string | null
          created_by_profile_id?: string | null
          description?: string
          estimated_budget_id?: string | null
          expense_date?: string
          group_id?: string | null
          id?: string
          is_carried_over?: boolean
          is_exceptional?: boolean
          profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "real_expenses_carried_from_recap_id_fkey"
            columns: ["carried_from_recap_id"]
            isOneToOne: false
            referencedRelation: "monthly_recaps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_expenses_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_expenses_estimated_budget_id_fkey"
            columns: ["estimated_budget_id"]
            isOneToOne: false
            referencedRelation: "estimated_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_expenses_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_expenses_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      real_income_entries: {
        Row: {
          amount: number
          applied_to_balance_at: string | null
          carried_from_recap_id: string | null
          created_at: string | null
          created_by_profile_id: string | null
          description: string
          entry_date: string
          estimated_income_id: string | null
          group_id: string | null
          id: string
          is_carried_over: boolean
          is_exceptional: boolean
          profile_id: string | null
        }
        Insert: {
          amount: number
          applied_to_balance_at?: string | null
          carried_from_recap_id?: string | null
          created_at?: string | null
          created_by_profile_id?: string | null
          description: string
          entry_date?: string
          estimated_income_id?: string | null
          group_id?: string | null
          id?: string
          is_carried_over?: boolean
          is_exceptional?: boolean
          profile_id?: string | null
        }
        Update: {
          amount?: number
          applied_to_balance_at?: string | null
          carried_from_recap_id?: string | null
          created_at?: string | null
          created_by_profile_id?: string | null
          description?: string
          entry_date?: string
          estimated_income_id?: string | null
          group_id?: string | null
          id?: string
          is_carried_over?: boolean
          is_exceptional?: boolean
          profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "real_income_entries_carried_from_recap_id_fkey"
            columns: ["carried_from_recap_id"]
            isOneToOne: false
            referencedRelation: "monthly_recaps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_income_entries_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_income_entries_estimated_income_id_fkey"
            columns: ["estimated_income_id"]
            isOneToOne: false
            referencedRelation: "estimated_incomes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_income_entries_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_income_entries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      remaining_to_live_snapshots: {
        Row: {
          available_balance: number
          created_at: string | null
          group_id: string | null
          id: string
          profile_id: string | null
          remaining_to_live: number
          snapshot_reason: string
          total_estimated_budgets: number
          total_estimated_income: number
          total_real_expenses: number
          total_real_income: number
          total_savings: number
        }
        Insert: {
          available_balance: number
          created_at?: string | null
          group_id?: string | null
          id?: string
          profile_id?: string | null
          remaining_to_live: number
          snapshot_reason: string
          total_estimated_budgets: number
          total_estimated_income: number
          total_real_expenses: number
          total_real_income: number
          total_savings: number
        }
        Update: {
          available_balance?: number
          created_at?: string | null
          group_id?: string | null
          id?: string
          profile_id?: string | null
          remaining_to_live?: number
          snapshot_reason?: string
          total_estimated_budgets?: number
          total_estimated_income?: number
          total_real_expenses?: number
          total_real_income?: number
          total_savings?: number
        }
        Relationships: [
          {
            foreignKeyName: "remaining_to_live_snapshots_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remaining_to_live_snapshots_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_expense_with_breakdown: {
        Args: {
          p_amount: number
          p_amount_from_budget: number
          p_amount_from_budget_savings: number
          p_amount_from_piggy_bank: number
          p_created_by_profile_id?: string
          p_description: string
          p_estimated_budget_id: string
          p_expense_date: string
          p_group_id?: string
          p_profile_id?: string
        }
        Returns: Json
      }
      add_expense_with_cross_budget_cascade: {
        Args: {
          p_amount: number
          p_amount_from_budget: number
          p_amount_from_local_savings: number
          p_amount_from_piggy_bank: number
          p_created_by_profile_id?: string
          p_cross_budget_debits: Json
          p_description: string
          p_estimated_budget_id: string
          p_expense_date: string
          p_group_id?: string
          p_profile_id?: string
        }
        Returns: Json
      }
      calculate_group_contributions: {
        Args: { group_id_param: string }
        Returns: undefined
      }
      delete_budget_with_savings_transfer: {
        Args: {
          p_budget_id: string
          p_group_id?: string
          p_profile_id?: string
        }
        Returns: Json
      }
      start_monthly_recap: {
        Args: {
          p_group_id?: string
          p_month: number
          p_profile_id?: string
          p_started_by_profile_id: string
          p_year: number
        }
        Returns: Json
      }
      toggle_real_expense_applied_to_balance: {
        Args: { p_apply: boolean; p_expense_id: string }
        Returns: Json
      }
      toggle_real_income_applied_to_balance: {
        Args: { p_apply: boolean; p_income_id: string }
        Returns: Json
      }
      transfer_budget_to_piggy_bank: {
        Args: {
          p_amount: number
          p_from_budget_id: string
          p_group_id?: string
          p_profile_id?: string
        }
        Returns: Json
      }
      transfer_from_piggy_to_budget: {
        Args: {
          p_amount: number
          p_budget_id: string
          p_group_id?: string
          p_profile_id?: string
        }
        Returns: Json
      }
      transfer_piggy_to_budget_with_insert: {
        Args: {
          p_amount: number
          p_group_id?: string
          p_profile_id?: string
          p_reason?: string
          p_recap_id?: string
          p_to_budget_id: string
        }
        Returns: Json
      }
      transfer_savings_between_budgets: {
        Args: {
          p_amount: number
          p_from_budget_id: string
          p_group_id?: string
          p_profile_id?: string
          p_to_budget_id: string
        }
        Returns: Json
      }
      transfer_with_savings_debit: {
        Args: {
          p_amount: number
          p_from_budget_id: string
          p_group_id?: string
          p_profile_id?: string
          p_reason?: string
          p_to_budget_id: string
        }
        Returns: Json
      }
      update_bank_balance: {
        Args: { p_delta: number; p_group_id?: string; p_profile_id?: string }
        Returns: number
      }
      update_budget_cumulated_savings: {
        Args: { p_budget_id: string; p_delta: number }
        Returns: number
      }
      update_piggy_bank_amount: {
        Args: { p_delta: number; p_group_id?: string; p_profile_id?: string }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
