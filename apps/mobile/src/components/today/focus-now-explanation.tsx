// The "why is this here?" block (Checkpoint 10.6, ADR-075 §1): every reason a
// Focus Now row carries as a `label — why` line with a chip naming where the
// evidence came from, then the auditable equation. Hookless, so the sheet
// tests can render it by tree-walk; the text is core's frozen table
// (`explainFocusNowCandidate`), never composed here and never a model's.
import type { FocusNowCandidateExplanation } from "@personal-os/core/focus-now/explain";
import { View } from "react-native";
import { AppText, StatusChip } from "@/components/ui";
import { FOCUS_NOW_SOURCE_LABEL, FOCUS_NOW_SOURCE_TONE } from "./focus-now-source-label";

export function FocusNowExplanationBlock({
  explanation,
  testID,
}: {
  explanation: FocusNowCandidateExplanation;
  testID?: string;
}) {
  return (
    <View testID={testID}>
      <AppText variant="overline" tone="muted" className="pb-1">
        {"Why it's here"}
      </AppText>
      {explanation.explanations.length === 0 ? (
        <AppText variant="body" tone="muted">
          No specific reason -- it is simply open today.
        </AppText>
      ) : (
        explanation.explanations.map((line) => (
          <View
            key={line.reason}
            className="flex-row items-start gap-2 py-1"
            accessible
            accessibilityLabel={`${line.label}: ${line.why}. Source: ${FOCUS_NOW_SOURCE_LABEL[line.source]}`}
          >
            <View className="flex-1">
              <AppText variant="body-strong" numberOfLines={2}>
                {line.label}
              </AppText>
              <AppText variant="label" tone="secondary" numberOfLines={2} className="font-normal">
                {line.why}
              </AppText>
            </View>
            <StatusChip
              tone={FOCUS_NOW_SOURCE_TONE[line.source]}
              label={FOCUS_NOW_SOURCE_LABEL[line.source]}
            />
          </View>
        ))
      )}
      {/* The equation is the audit trail: every term is a frozen point-table
          entry, so a ranking claim can be checked against the row itself. */}
      <AppText
        variant="caption"
        tone="muted"
        className="pt-1"
        accessibilityLabel={`Score: ${explanation.equation}`}
        testID="focus-now-equation"
      >
        {explanation.equation}
      </AppText>
    </View>
  );
}
