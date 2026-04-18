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
      app_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          admin_id: string
          after_value: Json | null
          before_value: Json | null
          created_at: string
          id: string
          metadata: Json | null
          reason: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          admin_id: string
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          id?: string
          metadata?: Json | null
          reason?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          id?: string
          metadata?: Json | null
          reason?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      bank_accounts: {
        Row: {
          account_holder_name: string
          account_number: string
          bank_name: string
          created_at: string
          id: string
          is_verified: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          account_holder_name: string
          account_number: string
          bank_name: string
          created_at?: string
          id?: string
          is_verified?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          account_holder_name?: string
          account_number?: string
          bank_name?: string
          created_at?: string
          id?: string
          is_verified?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exchange_rates: {
        Row: {
          from_currency: Database["public"]["Enums"]["wallet_currency"]
          id: string
          rate: number
          to_currency: Database["public"]["Enums"]["wallet_currency"]
          updated_at: string
        }
        Insert: {
          from_currency: Database["public"]["Enums"]["wallet_currency"]
          id?: string
          rate: number
          to_currency: Database["public"]["Enums"]["wallet_currency"]
          updated_at?: string
        }
        Update: {
          from_currency?: Database["public"]["Enums"]["wallet_currency"]
          id?: string
          rate?: number
          to_currency?: Database["public"]["Enums"]["wallet_currency"]
          updated_at?: string
        }
        Relationships: []
      }
      flagged_users: {
        Row: {
          created_at: string
          flagged_by: string
          id: string
          reason: string
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          user_id: string
        }
        Insert: {
          created_at?: string
          flagged_by: string
          id?: string
          reason: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          user_id: string
        }
        Update: {
          created_at?: string
          flagged_by?: string
          id?: string
          reason?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          user_id?: string
        }
        Relationships: []
      }
      intasend_transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          phone_number: string
          reference: string
          status: string
          transaction_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          phone_number: string
          reference: string
          status?: string
          transaction_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          phone_number?: string
          reference?: string
          status?: string
          transaction_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      kyc_verifications: {
        Row: {
          address: string
          date_of_birth: string
          document_number: string
          document_type: string
          id: string
          reviewed_at: string | null
          status: string
          submitted_at: string
          user_id: string
        }
        Insert: {
          address: string
          date_of_birth: string
          document_number: string
          document_type: string
          id?: string
          reviewed_at?: string | null
          status?: string
          submitted_at?: string
          user_id: string
        }
        Update: {
          address?: string
          date_of_birth?: string
          document_number?: string
          document_type?: string
          id?: string
          reviewed_at?: string | null
          status?: string
          submitted_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mpesa_payouts: {
        Row: {
          amount: number
          created_at: string
          fee: number
          id: string
          phone_number: string
          processed_at: string | null
          provider_response: Json | null
          reference: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          fee?: number
          id?: string
          phone_number: string
          processed_at?: string | null
          provider_response?: Json | null
          reference?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          fee?: number
          id?: string
          phone_number?: string
          processed_at?: string | null
          provider_response?: Json | null
          reference?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      paystack_transactions: {
        Row: {
          amount: number
          created_at: string
          currency: Database["public"]["Enums"]["wallet_currency"]
          id: string
          payment_method: string
          reference: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency: Database["public"]["Enums"]["wallet_currency"]
          id?: string
          payment_method: string
          reference: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: Database["public"]["Enums"]["wallet_currency"]
          id?: string
          payment_method?: string
          reference?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          kyc_status: string
          kyc_tier: string
          phone_number: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          kyc_status?: string
          kyc_tier?: string
          phone_number?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          kyc_status?: string
          kyc_tier?: string
          phone_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      transaction_pins: {
        Row: {
          created_at: string
          pin_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          pin_hash: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          pin_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          counterparty_user_id: string | null
          created_at: string
          currency: Database["public"]["Enums"]["wallet_currency"]
          description: string | null
          fee: number
          id: string
          status: Database["public"]["Enums"]["transaction_status"]
          type: Database["public"]["Enums"]["transaction_type"]
          user_id: string
        }
        Insert: {
          amount: number
          counterparty_user_id?: string | null
          created_at?: string
          currency: Database["public"]["Enums"]["wallet_currency"]
          description?: string | null
          fee?: number
          id?: string
          status?: Database["public"]["Enums"]["transaction_status"]
          type: Database["public"]["Enums"]["transaction_type"]
          user_id: string
        }
        Update: {
          amount?: number
          counterparty_user_id?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["wallet_currency"]
          description?: string | null
          fee?: number
          id?: string
          status?: Database["public"]["Enums"]["transaction_status"]
          type?: Database["public"]["Enums"]["transaction_type"]
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          currency: Database["public"]["Enums"]["wallet_currency"]
          id: string
          is_frozen: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          currency: Database["public"]["Enums"]["wallet_currency"]
          id?: string
          is_frozen?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          currency?: Database["public"]["Enums"]["wallet_currency"]
          id?: string
          is_frozen?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      withdrawal_requests: {
        Row: {
          amount: number
          bank_account_id: string
          created_at: string
          currency: Database["public"]["Enums"]["wallet_currency"]
          id: string
          processed_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          bank_account_id: string
          created_at?: string
          currency: Database["public"]["Enums"]["wallet_currency"]
          id?: string
          processed_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          bank_account_id?: string
          created_at?: string
          currency?: Database["public"]["Enums"]["wallet_currency"]
          id?: string
          processed_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_requests_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_adjust_balance: {
        Args: {
          _amount: number
          _currency: Database["public"]["Enums"]["wallet_currency"]
          _direction: string
          _reason: string
          _target_user: string
        }
        Returns: Json
      }
      admin_financial_overview: { Args: never; Returns: Json }
      admin_flag_user: {
        Args: { _reason: string; _severity?: string; _target_user: string }
        Returns: Json
      }
      admin_freeze_wallet: {
        Args: {
          _currency: Database["public"]["Enums"]["wallet_currency"]
          _frozen: boolean
          _reason: string
          _target_user: string
        }
        Returns: Json
      }
      admin_resolve_flag: {
        Args: { _flag_id: string; _note: string }
        Returns: Json
      }
      admin_set_role: {
        Args: {
          _grant: boolean
          _role: Database["public"]["Enums"]["app_role"]
          _target_user: string
        }
        Returns: Json
      }
      exchange_currency:
        | {
            Args: {
              _amount: number
              _from_currency: Database["public"]["Enums"]["wallet_currency"]
              _to_currency: Database["public"]["Enums"]["wallet_currency"]
            }
            Returns: Json
          }
        | {
            Args: {
              _amount: number
              _from_currency: Database["public"]["Enums"]["wallet_currency"]
              _pin?: string
              _to_currency: Database["public"]["Enums"]["wallet_currency"]
            }
            Returns: Json
          }
      fund_wallet: {
        Args: {
          _amount: number
          _currency: Database["public"]["Enums"]["wallet_currency"]
          _method: string
          _reference: string
          _user_id: string
        }
        Returns: Json
      }
      has_pin: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_any: { Args: never; Returns: boolean }
      request_withdrawal:
        | {
            Args: {
              _amount: number
              _bank_account_id: string
              _currency: Database["public"]["Enums"]["wallet_currency"]
            }
            Returns: Json
          }
        | {
            Args: {
              _amount: number
              _bank_account_id: string
              _currency: Database["public"]["Enums"]["wallet_currency"]
              _pin?: string
            }
            Returns: Json
          }
      send_to_mpesa: {
        Args: { _amount: number; _phone: string; _pin: string }
        Returns: Json
      }
      set_transaction_pin: { Args: { _pin: string }; Returns: Json }
      transfer_funds:
        | {
            Args: {
              _amount: number
              _currency: Database["public"]["Enums"]["wallet_currency"]
              _description: string
              _to_email: string
            }
            Returns: Json
          }
        | {
            Args: {
              _amount: number
              _currency: Database["public"]["Enums"]["wallet_currency"]
              _description: string
              _pin?: string
              _to_email: string
            }
            Returns: Json
          }
      verify_transaction_pin: { Args: { _pin: string }; Returns: boolean }
      withdraw_to_mpesa: {
        Args: { _amount: number; _phone: string; _pin: string }
        Returns: Json
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "user"
        | "super_admin"
        | "finance_admin"
        | "support_admin"
      transaction_status: "pending" | "completed" | "failed"
      transaction_type:
        | "transfer_in"
        | "transfer_out"
        | "deposit"
        | "withdrawal"
        | "exchange"
      wallet_currency: "KES" | "NGN" | "USD" | "EUR" | "GBP"
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
    Enums: {
      app_role: [
        "admin",
        "user",
        "super_admin",
        "finance_admin",
        "support_admin",
      ],
      transaction_status: ["pending", "completed", "failed"],
      transaction_type: [
        "transfer_in",
        "transfer_out",
        "deposit",
        "withdrawal",
        "exchange",
      ],
      wallet_currency: ["KES", "NGN", "USD", "EUR", "GBP"],
    },
  },
} as const
