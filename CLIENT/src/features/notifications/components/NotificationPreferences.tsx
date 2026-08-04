/**
 * NotificationPreferences — the delivery-channel toggles.
 *
 * OWNER-ONLY, and gated by the caller. These live in `integrationConfig` on the
 * settings document, which is OWNER-only server-side — a manager or cashier
 * would get a 403 from `GET /configuration`, so the tab is not offered to them
 * at all rather than rendering a panel that cannot load.
 *
 * ARCHITECTURE — this is the sanctioned reuse pattern, not an exception:
 * the data comes from the SETTINGS module (`useSettingsForm`, because
 * `integrationConfig` genuinely IS a block of the settings document), and the
 * presentation comes from the shared settings primitives. Notifications owns
 * neither. See docs/CONFIGURATION_OWNERSHIP.md §4.
 *
 * ⚠ WHAT IS WIRED AND WHAT IS NOT. `lowStockAlertsEnabled` gates a real
 * dispatch path. The email/SMS/WhatsApp channels are stored but not yet
 * delivered — `NotificationEngine.dispatch` writes the in-app row and has the
 * other channels stubbed. Each says so in the UI rather than implying an
 * effect it does not have, which is the same rule Receipt & Invoice follows.
 */

import { Bell, Mail, MessageSquare } from "lucide-react";

import {
  SettingsRow,
  SettingsSaveBar,
  SettingsSection,
  SettingsToggle,
  countChanges,
  useSettingsForm,
} from "@/features/settings";
import { Input } from "@/components/ui";

const OWNED_BLOCKS = ["integrationConfig"] as const;

export function NotificationPreferences() {
  const {
    draft,
    isLoading,
    isError,
    isSaving,
    isDirty,
    isFieldDirty,
    patch,
    setField,
    save,
    reset,
  } = useSettingsForm({ blocks: OWNED_BLOCKS });

  const changeCount = countChanges(patch);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  if (isError || !draft) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
        <p className="font-medium text-destructive">
          Could not load notification preferences
        </p>
        <p className="mt-1 text-muted-foreground">
          These settings are owner-only. If you are signed in as a manager or
          cashier, this is expected.
        </p>
      </div>
    );
  }

  const integration = draft.integrationConfig;

  return (
    <div className="flex flex-col gap-6 pb-24">
      {/* ══ IN-APP ALERTS ═══════════════════════════════════════════════ */}
      <SettingsSection
        title="In-app alerts"
        description="Which events create a notification in this list."
        icon={<Bell className="h-5 w-5" />}
      >
        <SettingsRow
          label="Low stock alerts"
          description="LIVE. Creates a notification when a variant falls to or below its reorder threshold."
          dirty={isFieldDirty("integrationConfig", "lowStockAlertsEnabled")}
        >
          <SettingsToggle
            label="Low stock alerts"
            checked={integration.lowStockAlertsEnabled}
            onChange={(v) =>
              setField("integrationConfig", "lowStockAlertsEnabled", v)
            }
          />
        </SettingsRow>

        <SettingsRow
          label="Daily summary"
          description="Stored. The digest job that would consume this is not built yet."
          dirty={isFieldDirty("integrationConfig", "dailySummaryEnabled")}
        >
          <SettingsToggle
            label="Daily summary"
            checked={integration.dailySummaryEnabled}
            onChange={(v) =>
              setField("integrationConfig", "dailySummaryEnabled", v)
            }
          />
        </SettingsRow>
      </SettingsSection>

      {/* ══ DELIVERY CHANNELS ═══════════════════════════════════════════ */}
      <SettingsSection
        title="Delivery channels"
        description="Where notifications are sent in addition to this list."
        icon={<Mail className="h-5 w-5" />}
      >
        <SettingsRow
          label="Email"
          description="Stored, not yet delivered. NotificationEngine writes the in-app row; the email channel is a declared stub."
          dirty={isFieldDirty("integrationConfig", "emailEnabled")}
        >
          <SettingsToggle
            label="Email"
            checked={integration.emailEnabled}
            onChange={(v) => setField("integrationConfig", "emailEnabled", v)}
          />
        </SettingsRow>

        <SettingsRow
          label="Sender email"
          description="The address outgoing notifications will come from once the email channel is built."
          dirty={isFieldDirty("integrationConfig", "senderEmail")}
        >
          <Input
            type="email"
            value={integration.senderEmail ?? ""}
            placeholder="alerts@yourstore.com"
            onChange={(e) =>
              setField("integrationConfig", "senderEmail", e.target.value)
            }
          />
        </SettingsRow>

        <SettingsRow
          label="SMS"
          description="Stored, not yet delivered."
          dirty={isFieldDirty("integrationConfig", "smsEnabled")}
        >
          <SettingsToggle
            label="SMS"
            checked={integration.smsEnabled}
            onChange={(v) => setField("integrationConfig", "smsEnabled", v)}
          />
        </SettingsRow>

        <SettingsRow
          label="WhatsApp"
          description="Stored, not yet delivered."
          dirty={isFieldDirty("integrationConfig", "whatsappEnabled")}
        >
          <SettingsToggle
            label="WhatsApp"
            checked={integration.whatsappEnabled}
            onChange={(v) => setField("integrationConfig", "whatsappEnabled", v)}
          />
        </SettingsRow>

        <SettingsRow
          label="Support phone"
          description="Shown to staff on alerts that need a human to call."
          dirty={isFieldDirty("integrationConfig", "supportPhone")}
        >
          <Input
            value={integration.supportPhone ?? ""}
            placeholder="+91 90000 00000"
            onChange={(e) =>
              setField("integrationConfig", "supportPhone", e.target.value)
            }
          />
        </SettingsRow>
      </SettingsSection>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Channel toggles are configuration, never credentials. API keys and
          tokens are server-side environment values and are deliberately not
          editable from any screen.
        </span>
      </p>

      <SettingsSaveBar
        visible={isDirty}
        saving={isSaving}
        changeCount={changeCount}
        onSave={() => void save()}
        onDiscard={reset}
      />
    </div>
  );
}
