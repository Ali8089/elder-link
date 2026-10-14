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
      activities: {
        Row: {
          active: boolean
          code: string
          en: string
          id: string
          zh: string
        }
        Insert: {
          active?: boolean
          code: string
          en: string
          id?: string
          zh: string
        }
        Update: {
          active?: boolean
          code?: string
          en?: string
          id?: string
          zh?: string
        }
        Relationships: []
      }
      activity_interests: {
        Row: {
          activity_code: string
          call_job_id: string | null
          created_at: string
          elder_id: string
          id: string
          source: string
        }
        Insert: {
          activity_code: string
          call_job_id?: string | null
          created_at?: string
          elder_id: string
          id?: string
          source?: string
        }
        Update: {
          activity_code?: string
          call_job_id?: string | null
          created_at?: string
          elder_id?: string
          id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_interests_call_job_id_fkey"
            columns: ["call_job_id"]
            isOneToOne: false
            referencedRelation: "call_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_interests_elder_id_fkey"
            columns: ["elder_id"]
            isOneToOne: false
            referencedRelation: "elders"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          at: string
          category: string
          id: string
          ref: string | null
          value: number
        }
        Insert: {
          at?: string
          category: string
          id?: string
          ref?: string | null
          value?: number
        }
        Update: {
          at?: string
          category?: string
          id?: string
          ref?: string | null
          value?: number
        }
        Relationships: []
      }
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
          version: number
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
          version?: number
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
          version?: number
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
          centre: string
          check_interval_days: number
          consent_checked_at: string | null
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
          preferred_call_time: string
          preferred_language: string
          reference_number: string
          status: string
          updated_at: string
        }
        Insert: {
          centre?: string
          check_interval_days?: number
          consent_checked_at?: string | null
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
          preferred_call_time?: string
          preferred_language?: string
          reference_number?: string
          status?: string
          updated_at?: string
        }
        Update: {
          centre?: string
          check_interval_days?: number
          consent_checked_at?: string | null
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
          preferred_call_time?: string
          preferred_language?: string
          reference_number?: string
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
      login_attempts: {
        Row: {
          email: string
          fails: number
          id: string
          ip: string
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          email: string
          fails?: number
          id?: string
          ip?: string
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          email?: string
          fails?: number
          id?: string
          ip?: string
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          case_id: string | null
          channel: string
          created_at: string
          detail: string | null
          elder_id: string
          id: string
          sent_at: string | null
          status: string
          target: string
        }
        Insert: {
          case_id?: string | null
          channel?: string
          created_at?: string
          detail?: string | null
          elder_id: string
          id?: string
          sent_at?: string | null
          status?: string
          target: string
        }
        Update: {
          case_id?: string | null
          channel?: string
          created_at?: string
          detail?: string | null
          elder_id?: string
          id?: string
          sent_at?: string | null
          status?: string
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_elder_id_fkey"
            columns: ["elder_id"]
            isOneToOne: false
            referencedRelation: "elders"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduler_runs: {
        Row: {
          chains_advanced: number
          detail: string | null
          finished_at: string | null
          id: string
          jobs_created: number
          jobs_run: number
          ok: boolean
          purged: number
          started_at: string
        }
        Insert: {
          chains_advanced?: number
          detail?: string | null
          finished_at?: string | null
          id?: string
          jobs_created?: number
          jobs_run?: number
          ok?: boolean
          purged?: number
          started_at?: string
        }
        Update: {
          chains_advanced?: number
          detail?: string | null
          finished_at?: string | null
          id?: string
          jobs_created?: number
          jobs_run?: number
          ok?: boolean
          purged?: number
          started_at?: string
        }
        Relationships: []
      }
      sensor_alerts: {
        Row: {
          alert_type: string
          call_job_id: string | null
          closed_at: string | null
          elder_id: string
          external_id: string
          human_informed_at: string | null
          id: string
          received_at: string
          safe_note: string | null
          status: string
        }
        Insert: {
          alert_type?: string
          call_job_id?: string | null
          closed_at?: string | null
          elder_id: string
          external_id: string
          human_informed_at?: string | null
          id?: string
          received_at?: string
          safe_note?: string | null
          status?: string
        }
        Update: {
          alert_type?: string
          call_job_id?: string | null
          closed_at?: string | null
          elder_id?: string
          external_id?: string
          human_informed_at?: string | null
          id?: string
          received_at?: string
          safe_note?: string | null
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
      clear_login_attempts: {
        Args: { p_email: string; p_ip: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      login_lock_status: {
        Args: { p_email: string; p_ip: string }
        Returns: string
      }
      purge_opted_out_elders: { Args: never; Returns: number }
      record_login_failure: {
        Args: { p_email: string; p_ip: string }
        Returns: string
      }
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
