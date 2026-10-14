<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Elder Link architecture
- Business rules live as pure functions in src/lib/engine.ts with tests in engine.test.ts — keeps timing/escalation rules testable with fixed clocks.
- Calls go through the TelephonyProvider interface in src/lib/telephony.ts (mock today) — a real provider can be swapped in without touching the orchestrator.
- All staff share data via RLS `is_staff()`; signup auto-grants the operator role — one shared dashboard view for the prototype.
