import {
  AGENT_DISCLOSURE_TEXT,
  AGENT_NAME_MAX_CHARS,
  AGENT_TRUST_LEVEL_LABELS,
  type AgentRegisterResponse,
  type AgentTrustLevel,
} from "@personal-os/schema";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { AGENT_TRUST_CHIP } from "@/components/agents/agents-state";
import { FieldLabel, fieldWellClass, textFieldClass } from "@/components/ask/text-field";
import { FieldLengthCounter } from "@/components/field-length-counter";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { usePlaceholderColor } from "@/components/placeholder-color";
import {
  AppText,
  Button,
  Card,
  Icon,
  ScreenFrame,
  SegmentedControl,
  StatusChip,
  showToast,
} from "@/components/ui";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { useRegisterAgent } from "@/queries/agents";
import { describeValidationError } from "@/utils/validation-error";

// Register an agent (Checkpoint 10.9, ADR-081 §9): a name, a trust level
// (Read or Propose -- Pause is reachable from the agent's own screen), and
// the disclosure the owner registers under, imported from the schema so the
// sentence agreed to is the sentence in the code (byte-pinned by
// src/__tests__/agents-trust-line.test.ts).
//
// The response is the ONLY time the raw token is visible: it is rendered
// once as selectable text, never in an input, never stored, never copied by
// this app (there is no clipboard dependency, on purpose). Leaving the
// screen forgets it. A refused field -- an over-bound paste -- lands in the
// inline banner through describeValidationError, never the raw message.

const TRUST_OPTIONS: readonly { value: AgentTrustLevel; label: string; testID: string }[] = [
  { value: "read", label: AGENT_TRUST_LEVEL_LABELS.read.label, testID: "agent-trust-read" },
  {
    value: "propose",
    label: AGENT_TRUST_LEVEL_LABELS.propose.label,
    testID: "agent-trust-propose",
  },
];

function agentRoute(id: string): Href {
  return `/agents/${encodeURIComponent(id)}` as Href;
}

function RegisteredCard({ result, onDone }: { result: AgentRegisterResponse; onDone: () => void }) {
  const chip = AGENT_TRUST_CHIP[result.agent.trust_level];
  return (
    <Card className="mb-4" testID="agent-registered">
      <View className="flex-row items-center gap-2">
        <Icon name="key-variant" size="md" tone="primary" />
        <AppText variant="title" className="flex-1">
          {result.agent.name}
        </AppText>
        <StatusChip label={chip.label} tone={chip.tone} icon={chip.icon} />
      </View>
      <AppText variant="caption" tone="warning" className="mt-3" accessibilityRole="alert">
        Copy this token now — it won&apos;t be shown again.
      </AppText>
      <View className={fieldWellClass("mt-2 py-3")}>
        <AppText
          selectable
          variant="body-strong"
          accessibilityLabel="Agent token"
          testID="agent-token"
        >
          {result.token}
        </AppText>
      </View>
      <AppText variant="caption" tone="secondary" className="mt-3">
        Give it to the agent once. Personal OS keeps only a hash; revoking the agent stops the token
        immediately.
      </AppText>
      <Button
        label="Done"
        onPress={onDone}
        variant="primary"
        icon="check"
        haptic={false}
        block
        className="mt-4"
        testID="agent-registered-done"
      />
    </Card>
  );
}

export default function NewAgentScreen() {
  const keyboardHeight = useKeyboardHeight();
  const placeholderColor = usePlaceholderColor();
  const router = useRouter();
  const registerAgent = useRegisterAgent();
  const [name, setName] = useState("");
  const [trustLevel, setTrustLevel] = useState<AgentTrustLevel>("read");

  const canRegister = name.trim().length > 0 && !registerAgent.isPending;

  const submit = () => {
    if (!canRegister) return;
    registerAgent.mutate(
      { name: name.trim(), trust_level: trustLevel },
      { onSuccess: () => showToast({ message: "Agent registered", tone: "success" }) },
    );
  };

  const result = registerAgent.data;

  return (
    <ScreenFrame>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {result ? (
          <RegisteredCard
            result={result}
            onDone={() => router.replace(agentRoute(result.agent.id))}
          />
        ) : (
          <>
            <FieldLabel>Name</FieldLabel>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="What you call this agent"
              placeholderTextColor={placeholderColor}
              // The server's own bound (packages/schema/src/agents.ts), so an
              // over-long paste is stopped here rather than refused as a 400.
              maxLength={AGENT_NAME_MAX_CHARS}
              autoCapitalize="words"
              editable={!registerAgent.isPending}
              accessibilityLabel="Agent name"
              className={textFieldClass({ extra: "mb-4" })}
              testID="agent-name"
            />
            <FieldLengthCounter length={name.length} maxLength={AGENT_NAME_MAX_CHARS} />

            <FieldLabel>Trust level</FieldLabel>
            <SegmentedControl<AgentTrustLevel>
              value={trustLevel}
              options={TRUST_OPTIONS}
              onChange={setTrustLevel}
              className="mb-2"
            />
            <AppText variant="caption" tone="secondary" className="mb-4" testID="agent-trust-help">
              {AGENT_TRUST_LEVEL_LABELS[trustLevel].description}
            </AppText>

            <Card
              variant="soft"
              className="mb-4"
              accessibilityLabel={`What this allows. ${AGENT_DISCLOSURE_TEXT}`}
            >
              <AppText variant="overline" tone="muted" className="pb-1">
                What this allows
              </AppText>
              <AppText variant="body" testID="agent-disclosure">
                {AGENT_DISCLOSURE_TEXT}
              </AppText>
            </Card>

            {registerAgent.isError ? (
              <AppText
                variant="body"
                tone="danger"
                className="mb-3"
                accessibilityRole="alert"
                testID="agent-register-error"
              >
                {describeValidationError(registerAgent.error) ?? "Couldn't register that agent."}
              </AppText>
            ) : null}

            <Button
              label="Register"
              onPress={submit}
              disabled={!canRegister}
              busy={registerAgent.isPending}
              variant="primary"
              icon="robot-outline"
              block
              testID="agent-register"
            />
          </>
        )}
      </ScrollView>
    </ScreenFrame>
  );
}
