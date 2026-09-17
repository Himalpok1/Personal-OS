import { ApiClientError } from "@personal-os/api-client";
import { View } from "react-native";
import { AppText, Button, Card, Icon, ListRow, StatusChip } from "@/components/ui";
import {
  useAskConsentOutdated,
  useAskEnabled,
  useAskModels,
  useDisableCloudAsk,
  useEnableCloudAsk,
} from "@/queries/ask";

// Settings card for Cloud Ask (Checkpoint 8.6B) -- the ONLY place enable/
// disable happens. Off by default, explicit opt-in only, no scheduled or
// background use, read-only and no autonomous action of any kind.
//
// Lives in its own file rather than inline in `app/settings.tsx` (a 1,400+
// line file with many native-module imports -- ExactAlarmStatus,
// GoogleCalendarAuth, expo-notifications -- that a focused test for this card
// should not have to load) so it can be exercised directly, following the
// precedent already set by `components/mail/digest-today-card.tsx` and
// `components/brief/brief-card.tsx`: a non-trivial mutation-backed card gets
// its own file and its own test, and the screen that hosts it just imports
// and renders it.
//
// DELIBERATELY NO LOCAL `useState`, for the same reason those two files carry
// none: this app's test harness calls a component directly with no React
// renderer and therefore no dispatcher, so any raw `useState` here would
// throw rather than merely fail an assertion. Every bit of this card's state
// -- whether Cloud Ask is on, which models exist, whether an enable/disable
// is in flight or failed -- already lives in the query/mutation hooks below,
// so there is nothing left for local state to hold.
//
// The disclosure and model picker are simply always visible whenever Cloud
// Ask is off -- there is no separate "tap to reveal" step and therefore no
// extra dialog to confirm on top of it. That IS the one-time consent: nothing
// is sent, and no route is created, until a specific model row is tapped.
// Disabling is a single reversible button with no confirmation, matching how
// this app treats other reversible per-device toggles rather than its
// destructive, hard-to-undo ones (mailbox disconnect, device revoke).
//
// Checkpoint 10.3 composed it on the design system (Card, ListRow, Button,
// StatusChip); every testID, label and the disclosure text are unchanged.

// Checkpoint 9.7 ("Ask about today") rewrote this to name every class of
// data that leaves, because the 8.6B text ("matching notes and tasks") no
// longer described the request. A row consented under the old text is refused
// by the server (`409 ask_consent_outdated`) until it is re-created under
// this one -- see the re-enable path below.
// Checkpoint 9.8 ("Suggested Focus") appends one sentence naming the new
// ACTION this same switch also covers -- no new category of data leaves (a
// suggestion only ever sees a subset of the schedule information already
// named above), so the addition names what the tap does, not a new data
// class. cloud-ask-card.test.tsx's byte-exact pin is updated in lockstep.
export const ASK_DISCLOSURE_TEXT =
  "Sends your question to the model you choose, along with: matching notes and tasks (up to 4, " +
  "bodies included, secrets redacted by pattern only); the titles, times and project names of " +
  "your tasks, reminders and calendar events for today and the next 7 days (calendar titles and " +
  "locations were written by whoever created the invitation); tasks you completed in the last 7 " +
  "days; the text of up to 5 unfiled captures; project names and task counts; and whether your " +
  "reviews are done. Nothing is stored. Personal OS cannot verify how the provider handles it. " +
  "Tapping Suggest focus on Today sends this same today's-schedule information so the model can " +
  "pick one task to suggest you focus on next.";

// Context that is true whether or not Cloud Ask is on, kept beside the
// disclosure rather than folded into it so the list above stays exactly the
// list of what an Ask sends.
const ASK_CONTEXT_TEXT =
  "Only a question you tap Ask on is sent, and only for that one question. This is separate " +
  "from capture parsing: Personal OS already sends the text of every new capture to an AI " +
  "model to file it, whether or not Cloud Ask is on. Turning Cloud Ask off stops new questions " +
  "immediately, though a question already in flight may still finish.";

/** Shown on an enabled card once the server has refused a question as consented under older text. */
export const ASK_CONSENT_OUTDATED_TEXT =
  "Cloud Ask was enabled under an older disclosure. Re-enable to continue.";

function describeEnableFailure(err: unknown): string {
  if (err instanceof ApiClientError) {
    switch (err.code) {
      case "validation_failed":
        return "That model selection wasn't valid.";
      case "not_found":
        return "That model no longer exists.";
      default:
        return "Something went wrong. Try again.";
    }
  }
  return "Something went wrong. Try again.";
}

export function CloudAskCard() {
  const enabledQuery = useAskEnabled();
  const modelsQuery = useAskModels();
  const enableMutation = useEnableCloudAsk();
  const disableMutation = useDisableCloudAsk();
  // Set by a `409 ask_consent_outdated` from the search screen; cleared by a
  // successful disable. The only re-enable path is the honest one: delete
  // the stale row (this same Disable mutation), after which the disclosure
  // and the model picker reappear below and a fresh row is created under
  // the text on screen. There is no "re-point in place" -- the server
  // refuses that too (`ask_route_immutable`), for the same reason.
  const consentOutdated = useAskConsentOutdated();

  const isLoading = enabledQuery.isLoading;
  const isError = enabledQuery.isError;
  const enabled = enabledQuery.enabled;
  const route = enabledQuery.route;

  const statusText = isLoading
    ? "Loading…"
    : isError
      ? "Can't reach Personal OS, so the Cloud Ask status is unknown."
      : enabled && route
        ? `On — sends questions to ${route.connection_name}.`
        : "Off — no question is ever sent unless you turn this on.";

  const statusChip = isLoading
    ? null
    : isError
      ? { label: "Unknown", tone: "warning" as const }
      : enabled
        ? { label: "On", tone: "success" as const }
        : { label: "Off", tone: "neutral" as const };

  return (
    <Card testID="cloud-ask-card" className="mb-4">
      <View className="flex-row items-center gap-2">
        <Icon name="cloud-question" size="md" tone="primary" />
        <AppText variant="title" className="flex-1">
          Cloud Ask
        </AppText>
        {statusChip ? <StatusChip label={statusChip.label} tone={statusChip.tone} dot /> : null}
      </View>
      <AppText variant="body" tone={isError ? "danger" : "secondary"} className="mt-2 min-h-[20px]">
        {statusText}
      </AppText>

      {!isLoading && !isError && enabled && consentOutdated ? (
        <AppText
          testID="cloud-ask-consent-outdated"
          variant="caption"
          tone="warning"
          className="mt-2"
        >
          {ASK_CONSENT_OUTDATED_TEXT}
        </AppText>
      ) : null}

      {!isLoading && !isError && enabled ? (
        <View>
          <Button
            testID="cloud-ask-disable"
            label={
              disableMutation.isPending
                ? "Turning off…"
                : consentOutdated
                  ? "Disable, then re-enable below"
                  : "Disable Cloud Ask"
            }
            onPress={() => disableMutation.mutate()}
            disabled={disableMutation.isPending}
            accessibilityLabel={
              consentOutdated ? "Disable Cloud Ask to re-enable it" : "Disable Cloud Ask"
            }
            variant="danger"
            size="sm"
            className="mt-3"
          />
          {disableMutation.isError ? (
            <AppText
              testID="cloud-ask-disable-error"
              variant="caption"
              tone="danger"
              className="mt-2"
            >
              Couldn&apos;t turn off Cloud Ask. Something went wrong. Try again.
            </AppText>
          ) : null}
        </View>
      ) : null}

      {!isLoading && !isError && !enabled ? (
        <View testID="cloud-ask-disclosure" className="mt-3">
          <AppText
            testID="cloud-ask-disclosure-text"
            variant="caption"
            tone="secondary"
            className="mb-2"
          >
            {ASK_DISCLOSURE_TEXT}
          </AppText>
          <AppText
            testID="cloud-ask-context-text"
            variant="caption"
            tone="secondary"
            className="mb-2"
          >
            {ASK_CONTEXT_TEXT}
          </AppText>

          {modelsQuery.isLoading ? (
            <AppText variant="label" tone="muted" className="font-normal">
              Loading available models…
            </AppText>
          ) : modelsQuery.isError ? (
            <AppText variant="label" tone="danger" className="font-normal">
              Couldn&apos;t load AI models.
            </AppText>
          ) : modelsQuery.models.length === 0 ? (
            <AppText
              testID="cloud-ask-no-models"
              variant="label"
              tone="muted"
              className="font-normal"
            >
              No AI models are registered yet. Add a provider connection and model first.
            </AppText>
          ) : (
            <Card padding="none" elevation="flat" className="mt-1">
              {modelsQuery.models.map((model, index) => (
                <ListRow
                  key={model.modelId}
                  testID={`cloud-ask-model-${model.modelId}`}
                  icon="robot-outline"
                  iconTone="primary"
                  title={model.modelLabel}
                  subtitle={`${model.connectionName} · ${model.providerType}`}
                  onPress={() => enableMutation.mutate(model.modelId)}
                  disabled={enableMutation.isPending}
                  accessibilityLabel={`Enable Cloud Ask with ${model.modelLabel}`}
                  chevron
                  last={index === modelsQuery.models.length - 1}
                />
              ))}
            </Card>
          )}

          {enableMutation.isError ? (
            <AppText
              testID="cloud-ask-enable-error"
              variant="caption"
              tone="danger"
              className="mt-2"
            >
              {describeEnableFailure(enableMutation.error)}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
