import type { PermissionGrantItem } from "@personal-os/schema";
import { View } from "react-native";
import { confirmDestructive } from "@/components/confirm-destructive";
import { AppText, Button, Card, Icon, StatusChip } from "@/components/ui";
import { permissionCardPresentation, permissionCardSpoken } from "./permission-card-state";

// One capability the `app` principal holds (Checkpoint 10.8, ADR-078 §3/§8):
// a consumer surface, not an OAuth scope list -- the capability, its state
// chip, what it is used for, how often, the actions it covers, and the
// rule-9 toggle (docs/MOBILE-DESIGN-SYSTEM.md): a `Button variant="tonal"
// size="sm"` whose label names the action it will take. "Revoke" goes
// through `confirmDestructive` because a revoke CANCELS pending work (§3);
// "Allow" does not, because nothing runs on a grant alone.
//
// Hookless and prop-driven, so the tree-walking tests render it directly;
// every decision is in permission-card-state.ts.

export interface PermissionCardProps {
  item: PermissionGrantItem;
  /** `granted: false` arrives only after the owner confirmed the revoke. */
  onToggle: (granted: boolean) => void;
  pending?: boolean;
  /** For the usage line's date; the device zone when omitted. */
  timeZone?: string;
  testID?: string;
}

export function PermissionCard({
  item,
  onToggle,
  pending = false,
  timeZone,
  testID,
}: PermissionCardProps) {
  const view = permissionCardPresentation(item, { timeZone });
  const toggle = () => {
    if (item.granted) {
      confirmDestructive({
        title: view.revokeTitle,
        message: view.revokeMessage,
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
        accessibilityLabel={permissionCardSpoken(item, view)}
      >
        <View className="flex-row items-center gap-2">
          <Icon name={view.icon} size="md" tone="primary" />
          <AppText variant="title" className="flex-1">
            {item.label}
          </AppText>
          <StatusChip
            label={view.stateChip.label}
            tone={view.stateChip.tone}
            dot
            accessibilityLabel={`${item.label} ${view.stateChip.label}`}
          />
        </View>
        {view.reconsentChip ? (
          <View className="mt-2 flex-row">
            <StatusChip
              label={view.reconsentChip.label}
              tone={view.reconsentChip.tone}
              icon="alert-outline"
            />
          </View>
        ) : null}
        <AppText variant="caption" tone="secondary" className="mt-2">
          {item.description}
        </AppText>
        <AppText
          variant="caption"
          tone="muted"
          className="mt-1"
          testID={`${testID ?? "permission"}-usage`}
        >
          {view.usageLine}
        </AppText>
        {view.actionNames.length > 0 ? (
          <View className="mt-3 flex-row flex-wrap gap-1.5">
            {view.actionNames.map((name) => (
              <StatusChip key={name} label={name} tone="neutral" />
            ))}
          </View>
        ) : null}
      </View>
      <Button
        label={pending ? (item.granted ? "Revoking" : "Allowing") : view.toggleLabel}
        onPress={toggle}
        busy={pending}
        accessibilityLabel={`${view.toggleLabel} ${item.label} access`}
        variant="tonal"
        size="sm"
        className="mt-3"
        testID={`${testID ?? "permission"}-toggle`}
      />
    </Card>
  );
}
