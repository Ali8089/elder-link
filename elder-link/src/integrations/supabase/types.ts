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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          actor: string | null
          at: string
          entity: string
          entity_id: string | null
          id: string
        }
        Insert: {
          action: string
          actor?: string | null
          at?: string
          entity: string
          entity_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor?: string | null
          at?: string
          entity?: string
          entity_id?: string | null
          id?: string
        }
        Relationships: []
      }
      call_jobs: {
        Row: {
          activity_suggestion: string | null
          attempt: number
          completed_at: string | null
          created_at: string
          due_at: string
          elder_id: string
          id: string
          kind: string
          outcome: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          activity_suggestion?: string | null
          attempt?: number
          completed_at?: string | null
          created_at?: string
          due_at?: string
          elder_id: string
          id?: string
          kind: string
          outcome?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          activity_suggestion?: string | null
          attempt?: number
          completed_at?: string | null
          created_at?: string
          due_at?: string
          elder_id?: string
          id?: string
          kind?: string
          outcome?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_jobs_elder_id_fkey"
            columns: ["elder_id"]
            isOneToOne: false
            referencedRelation: "elders"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          call_job_id: string | null
          closed_at: string | null
          created_at: string
          elder_id: string
          escalation_started_at: string | null
          id: string
          note: string | null
          reason: string
          severity: number
          status: string
          trigger_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          call_job_id?: string | null
          closed_at?: string | null
          created_at?: string
          elder_id: string
          escalation_started_at?: string | null
          id?: string
          note?: string | null
          reason: string
          severity?: number
          status?: string
          trigger_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          call_job_id?: string | null
          closed_at?: string | null
          created_at?: string
          elder_id?: string
          escalation_started_at?: string | null
          id?: string
          note?: string | null
          reason?: string
          severity?: number
          status?: string
          trigger_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_call_job_id_fkey"
            columns: ["call_job_id"]
            isOneToOne: false
            referencedRelation: "call_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_elder_id_fkey"
            columns: ["elder_id"]
            isOneToOne: false
            referencedRelation: "elders"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          elder_id: string
          id: string
          name: string
          phone: string
          priority: number
          relation: string
        }
        Insert: {
          elder_id: string
          id?: string
          name: string
          phone: string
          priority: number
          relation?: string
        }
        Update: {
          elder_id?: string
          id?: string
          name?: string
          phone?: string
          priority?: number
          relation?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_elder_id_fkey"
            columns: ["elder_id"]
            isOneToOne: false
            referencedRelation: "elders"
            referencedColumns: ["id"]
          },
        ]
      }
      elders: {
        Row: {
          check_interval_days: number
          consent_contact: boolean
          consent_elder: boolean
          consent_service: boolean
          created_at: string
          display_name: string
          district: string
          id: string
          last_check_at: string | null
          next_check_at: string | null
          opted_out_at: string | null
          phone: string
          preferred_language: string
          status: string
          updated_at: string
        }
        Insert: {
          check_interval_days?: number
          consent_contact?: boolean
          consent_elder?: boolean
          consent_service?: boolean
          created_at?: string
          display_name: string
          district?: string
          id?: string
          last_check_at?: string | null
          next_check_at?: string | null
          opted_out_at?: string | null
          phone?: string
          preferred_language?: string
          status?: string
          updated_at?: string
        }
        Update: {
          check_interval_days?: number
          consent_contact?: boolean
          consent_elder?: boolean
          consent_service?: boolean
          created_at?: string
          display_name?: string
          district?: string
          id?: string
          last_check_at?: string | null
          next_check_at?: string | null
          opted_out_at?: string | null
          phone?: string
          preferred_language?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      escalation_steps: {
        Row: {
          case_id: string
          ended_at: string | null
          id: string
          started_at: string | null
          status: string
          step_order: number
          target: string
          target_label: string
        }
        Insert: {
          case_id: string
          ended_at?: string | null
          id?: string
          started_at?: string | null
          status?: string
          step_order: number
          target: string
          target_label?: string
        }
        Update: {
          case_id?: string
          ended_at?: string | null
          id?: string
          started_at?: string | null
          status?: string
          step_order?: number
          target?: string
          target_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalation_steps_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      sensor_alerts: {
        Row: {
          alert_type: string
          call_job_id: string | null
          closed_at: string | null
          elder_id: string
          external_id: string
          id: string
          received_at: string
          status: string
        }
        Insert: {
          alert_type?: string
          call_job_id?: string | null
          closed_at?: string | null
          elder_id: string
          external_id: string
          id?: string
          received_at?: string
          status?: string
        }
        Update: {
          alert_type?: string
          call_job_id?: string | null
          closed_at?: string | null
          elder_id?: string
          external_id?: string
          id?: string
          received_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sensor_alerts_call_job_id_fkey"
            columns: ["call_job_id"]
            isOneToOne: false
            referencedRelation: "call_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sensor_alerts_elder_id_fkey"
            columns: ["elder_id"]
            isOneToOne: false
            referencedRelation: "elders"
            referencedColumns: ["id"]
          },
        ]
      }
      telephony_events: {
        Row: {
          call_job_id: string | null
          event_id: string
          event_type: string
          id: string
          received_at: string
        }
        Insert: {
          call_job_id?: string | null
          event_id: string
          event_type: string
          id?: string
          received_at?: string
        }
        Update: {
          call_job_id?: string | null
          event_id?: string
          event_type?: string
          id?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telephony_events_call_job_id_fkey"
            columns: ["call_job_id"]
            isOneToOne: false
            referencedRelation: "call_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      purge_opted_out_elders: { Args: never; Returns: number }
    }
    Enums: {
      app_role: "admin" | "operator"
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
      app_role: ["admin", "operator"],
    },
  },
} as const
