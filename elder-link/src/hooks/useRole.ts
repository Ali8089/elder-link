// Reads the signed-in user's role from the database rather than trusting
// anything held in the client.
//
// The database is the authority: RLS policies decide what the user can actually
// read, and this hook decides what the UI should render. If the two disagree the
// database wins and the user simply sees an empty list — never someone else's
// data. See supabase/migrations/0002_family_monitoring.sql.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { familyMembersTable } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";

export type AppRole = "admin" | "operator" | "family";

export type RoleState = {
  /** Every role the user holds. A user can be both staff and family. */
  roles: AppRole[];
  /** True while the lookup is in flight. */
  loading: boolean;
  /** Operational roles only — these may act on care decisions. */
  isStaff: boolean;
  /** A relative following an elder. Read-only over care data. */
  isFamily: boolean;
  /** The elder ids this user may see (family only; empty for staff). */
  linkedElderIds: string[];
};

const EMPTY: RoleState = {
  roles: [],
  loading: true,
  isStaff: false,
  isFamily: false,
  linkedElderIds: [],
};

export function useRole(): RoleState {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<RoleState>(EMPTY);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setState({ ...EMPTY, loading: false });
      return;
    }
    let cancelled = false;
    (async () => {
      // Roles are readable by the user themselves under the existing policy.
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      const roles = (roleRows ?? []).map((r) => r["role"] as AppRole);

      // RLS already restricts this to the caller's own links, so an empty
      // result is the correct answer for a staff-only user.
      let linkedElderIds: string[] = [];
      if (roles.includes("family")) {
        const { data: links } = await familyMembersTable(supabase)
          .select("elder_id")
          .order("created_at");
        linkedElderIds = [
          ...new Set(
            ((links ?? []) as Record<string, unknown>[]).map((l) => String(l["elder_id"])),
          ),
        ];
      }

      if (cancelled) return;
      setState({
        roles,
        loading: false,
        isStaff: roles.includes("admin") || roles.includes("operator"),
        isFamily: roles.includes("family"),
        linkedElderIds,
      });
    })();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  return state;
}
