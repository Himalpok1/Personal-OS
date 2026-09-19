import type { AgentPermissionGrantItem } from "@personal-os/schema";
import { View } from "react-native";
import { confirmDestructive } from "@/components/confirm-destructive";
import { AppText, Button, Card, Icon, StatusChip } from "@/components/ui";
import { permissionCardCopy, permissionCardSpoken } from "./agents-state";

// One capability the `agent` principal holds (Checkpoint 10.9, ADR-081 §3/
// §9): its own component beside components/actions/permission-card.tsx
// rather than a variant of it, because an agent grant carries a KIND (a
// read permission covers tools, a write permission covers actions) the
// `app` card's wire shape cannot express. The capability, its kind chip and
// category icon, the state chip, what it covers, and the rule-9 toggle
// (docs/MOBILE-DESIGN-SYSTEM.md): a `Button variant="tonal" size="sm"` whose
// label names the action it will take. "Revoke" goes through
// `confirmDestructive` because a revoked write cancels pending agent work and
// a revoked read stops every agent mid-task; "Allow" does not, because
// nothing runs on a grant alone. Never a Switch.
//
// Hookless and prop-driven, so the tree-walking tests render it directly;
// every decision is in agents-state.ts.

export interface AgentPermissionCardProps {
  item: AgentPermissionGrantItem;
  /** `granted: false` arrives only after the owner confirmed the revoke. */
  onToggle: (granted: boolean) => void;
  pending?: boolean;
  testID?: string;
}

export function AgentPermissionCard({
  item,
  onToggle,
  pending = false,
  testID,
}: AgentPermissionCardProps) {
  const copy = permissionCardCopy(item);
  const toggle = () => {
    if (item.granted) {
      confirmDestructive({
        title: copy.revokeTitle,
        message: copy.revokeMessage,
        confirmLabel: "Revoke",
        onConfirm: () => onToggle(false),
      });
      return;
    }
    onToggle(true);
  };
  return (
    <Card className="mb-3" testID={testID}>
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={permissionCardSpoken(item, copy)}
      >
        <View className="flex-row items-center gap-2">
          <Icon name={copy.icon} size="md" tone="primary" />
          <AppText variant="title" className="flex-1">
            {item.label}
          </AppText>
          <StatusChip
            label={copy.stateChip.label}
            tone={copy.stateChip.tone}
            dot
            accessibilityLabel={`${item.label} ${copy.stateChip.label}`}
          />
        </View>
        <View className="mt-2 flex-row flex-wrap gap-1.5">
          <StatusChip
            label={copy.kindChip.label}
            tone={copy.kindChip.tone}
            icon={copy.kindChip.icon}
          />
          {copy.reconsentChip ? (
            <StatusChip
              label={copy.reconsentChip.label}
              tone={copy.reconsentChip.tone}
              icon="alert-outline"
            />
          ) : null}
        </View>
        <AppText variant="caption" tone="secondary" className="mt-2">
          {item.description}
        </AppText>
        {copy.coverage.length > 0 ? (
          <View
            className="mt-3 flex-row flex-wrap gap-1.5"
            testID={`${testID ?? "agent-permission"}-coverage`}
          >
            {copy.coverage.map((name) => (
              <StatusChip key={name} label={name} tone="neutral" />
            ))}
          </View>
        ) : null}
      </View>
      <Button
        label={pending ? (item.granted ? "Revoking" : "Allowing") : copy.toggleLabel}
        onPress={toggle}
        busy={pending}
        accessibilityLabel={`${copy.toggleLabel} ${item.label} for agents`}
        variant="tonal"
        size="sm"
        className="mt-3"
        testID={`${testID ?? "agent-permission"}-toggle`}
      />
    </Card>
  );
}
