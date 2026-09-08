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
      audit_events: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: []
      }
      check_ins: {
        Row: {
          checked_in_at: string
          checked_in_by: string | null
          delegate_id: string
          device_label: string | null
          id: string
          method: Database["public"]["Enums"]["check_in_method"]
          notes: string | null
        }
        Insert: {
          checked_in_at?: string
          checked_in_by?: string | null
          delegate_id: string
          device_label?: string | null
          id?: string
          method: Database["public"]["Enums"]["check_in_method"]
          notes?: string | null
        }
        Update: {
          checked_in_at?: string
          checked_in_by?: string | null
          delegate_id?: string
          device_label?: string | null
          id?: string
          method?: Database["public"]["Enums"]["check_in_method"]
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_delegate_id_fkey"
            columns: ["delegate_id"]
            isOneToOne: true
            referencedRelation: "delegates"
            referencedColumns: ["id"]
          },
        ]
      }
      delegates: {
        Row: {
          badge_code: string
          badge_token: string
          created_at: string
          email: string
          full_name: string
          id: string
          import_batch_id: string | null
          organization: string
          phone: string | null
          source: Database["public"]["Enums"]["delegate_source"]
          status: Database["public"]["Enums"]["delegate_status"]
          updated_at: string
        }
        Insert: {
          badge_code?: string
          badge_token?: string
          created_at?: string
          email: string
          full_name: string
          id?: string
          import_batch_id?: string | null
          organization: string
          phone?: string | null
          source?: Database["public"]["Enums"]["delegate_source"]
          status?: Database["public"]["Enums"]["delegate_status"]
          updated_at?: string
        }
        Update: {
          badge_code?: string
          badge_token?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          import_batch_id?: string | null
          organization?: string
          phone?: string | null
          source?: Database["public"]["Enums"]["delegate_source"]
          status?: Database["public"]["Enums"]["delegate_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delegates_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          errors: Json
          filename: string
          id: string
          inserted: number
          skipped: number
          total_rows: number
          updated: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          errors?: Json
          filename: string
          id?: string
          inserted?: number
          skipped?: number
          total_rows?: number
          updated?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          errors?: Json
          filename?: string
          id?: string
          inserted?: number
          skipped?: number
          total_rows?: number
          updated?: number
        }
        Relationships: []
      }
      staff_profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string
          full_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          full_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          full_name?: string
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_and_check_in: {
        Args: {
          p_device_label?: string
          p_email: string
          p_full_name: string
          p_organization: string
          p_phone?: string
        }
        Returns: Json
      }
      admin_exists: { Args: never; Returns: boolean }
      check_in_delegate: {
        Args: {
          p_device_label?: string
          p_lookup: string
          p_method: Database["public"]["Enums"]["check_in_method"]
          p_notes?: string
        }
        Returns: Json
      }
      claim_first_admin: {
        Args: { p_email: string; p_full_name: string; p_user_id: string }
        Returns: boolean
      }
      dashboard_stats: { Args: never; Returns: Json }
      generate_badge_code: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_delegates: {
        Args: { p_filename: string; p_rows: Json }
        Returns: Json
      }
      is_active_admin: { Args: { _user_id: string }; Returns: boolean }
      is_active_staff: { Args: { _user_id: string }; Returns: boolean }
      log_audit: {
        Args: {
          _action: string
          _entity_id: string
          _entity_type: string
          _metadata: Json
        }
        Returns: undefined
      }
      public_create_badge: {
        Args: {
          p_email: string
          p_full_name: string
          p_organization: string
          p_phone?: string
        }
        Returns: Json
      }
      public_find_badge: { Args: { p_email: string }; Returns: Json }
      remove_test_delegates: { Args: never; Returns: number }
      valid_email: { Args: { _email: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "staff"
      check_in_method: "qr" | "search" | "walk_in"
      delegate_source: "import" | "public" | "walk_in"
      delegate_status: "expected" | "checked_in"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "staff"],
      check_in_method: ["qr", "search", "walk_in"],
      delegate_source: ["import", "public", "walk_in"],
      delegate_status: ["expected", "checked_in"],
    },
  },
} as const
