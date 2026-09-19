import { describe, expect, it } from "vitest";

// Source pins for the Agent Center's route modules (Checkpoint 10.9, ADR-081
// §9, ADR-082). The screens are hooked route modules with no render harness,
// so what matters about them is read from source, the content-bounds idiom:
//
//   * the raw agent token is rendered ONCE, as selectable text, never in a
//     TextInput, and nothing under the agent files persists it -- no
//     SecureStore, AsyncStorage or localStorage, no clipboard dependency;
//   * every write goes through the device-bound hooks (queries/agents.ts) and
//     the revoke through confirmDestructive;
//   * no clock is read in render (rule 7): relative times take a query's
//     `dataUpdatedAt`.
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string[], o: Record<string, unknown>) => Record<string, string>;
  }
).glob(
  [
    "../app/agents/**/*.tsx",
    "../components/agents/**/*.{ts,tsx}",
    "../queries/agents.ts",
    "../queries/device-token.ts",
    "../app/settings.tsx",
    "../app/_layout.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

const nonTest = Object.entries(SOURCES).filter(([path]) => !/\.test\.tsx?$/.test(path));

function source(path: string): string {
  const found = SOURCES[path];
  if (found === undefined) throw new Error(`${path} not found`);
  return stripComments(found);
}

describe("app/agents/new.tsx shows the token once and keeps nothing", () => {
  const body = source("../app/agents/new.tsx");

  it("renders the token through a selectable AppText with testID agent-token, never a TextInput", () => {
    expect(body).toMatch(
      /<AppText\s+selectable[\s\S]*?testID="agent-token"[\s\S]*?>\s*\{result\.token\}/,
    );
    // The only TextInput on the screen is the name field.
    const inputs = body.match(/<TextInput\b/g) ?? [];
    expect(inputs).toHaveLength(1);
    expect(body).toMatch(/<TextInput\b[\s\S]*?value=\{name\}/);
    expect(body).not.toMatch(/value=\{result\.token\}/);
  });

  it("uses the schema's bound on the name and describeValidationError on the banner", () => {
    expect(body).toMatch(/maxLength=\{AGENT_NAME_MAX_CHARS\}/);
    expect(body).toMatch(/describeValidationError\(registerAgent\.error\) \?\?/);
  });

  it("registers through the device-bound hook and defaults to Read", () => {
    expect(body).toMatch(/useRegisterAgent\(\)/);
    expect(body).toMatch(/useState<AgentTrustLevel>\("read"\)/);
  });
});

describe("no agent file persists or copies a token", () => {
  it("names no storage or clipboard API", () => {
    const offenders = nonTest
      .filter(([path]) => !path.startsWith("../app/settings") && !path.startsWith("../app/_layout"))
      .filter(([, body]) =>
        /SecureStore|AsyncStorage|localStorage|sessionStorage|expo-clipboard|Clipboard\b/.test(
          stripComments(body),
        ),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe("app/agents/[id].tsx", () => {
  const body = source("../app/agents/[id].tsx");

  it("revokes only through confirmDestructive and the device-bound hook", () => {
    expect(body).toMatch(/confirmDestructive\(\{[\s\S]*?confirmLabel: "Revoke"/);
    expect(body).toMatch(/useRevokeAgent\(\)/);
    expect(body).not.toMatch(/Alert\.alert/);
  });

  it("takes relative time from the queries' dataUpdatedAt, never a clock", () => {
    expect(body).toMatch(/agent\.dataUpdatedAt/);
    expect(body).toMatch(/activity\.dataUpdatedAt/);
    expect(body).not.toMatch(/Date\.now\(\)|new Date\(\)/);
  });

  it("says permissions are per principal", () => {
    expect(body).toContain("Permissions apply to every agent. Trust level is per agent.");
  });
});

describe("app/agents/index.tsx", () => {
  const body = source("../app/agents/index.tsx");

  it("draws one gradient, counts agent proposals from the pending list, and reads no clock", () => {
    expect((body.match(/<GradientCard\b/g) ?? []).length).toBe(1);
    expect(body).toMatch(/useActions\(\{ status: "pending", limit: PENDING_LIMIT \}\)/);
    expect(body).toMatch(/countAgentProposals\(/);
    expect(body).toMatch(/agents\.dataUpdatedAt/);
    expect(body).not.toMatch(/Date\.now\(\)|new Date\(\)/);
  });
});

describe("registration and placement", () => {
  it("the root layout registers the three agent screens", () => {
    const layout = source("../app/_layout.tsx");
    for (const name of ["agents/index", "agents/new", "agents/[id]"]) {
      expect(layout).toContain(`<Stack.Screen name="${name}"`);
    }
  });

  it("Settings places the Agents card after Actions and before Memory under Privacy & AI", () => {
    const settings = source("../app/settings.tsx");
    const privacy = settings.indexOf('title="Privacy & AI"');
    const actions = settings.indexOf("<ActionsSettingsCard />");
    const agents = settings.indexOf("<AgentsSettingsCard />");
    const memory = settings.indexOf("<MemorySettingsCard />");
    expect(privacy).toBeGreaterThan(-1);
    expect(actions).toBeGreaterThan(privacy);
    expect(agents).toBeGreaterThan(actions);
    expect(memory).toBeGreaterThan(agents);
    expect(settings.match(/<AgentsSettingsCard \/>/g)).toHaveLength(1);
  });
});

describe("the device-bound hooks", () => {
  it("every agent read is disabled without a token and every write requires one", () => {
    const body = source("../queries/agents.ts");
    expect((body.match(/enabled: token !== null/g) ?? []).length).toBe(4);
    expect((body.match(/requireDeviceToken\(token\)/g) ?? []).length).toBe(4);
    expect((body.match(/onError: toastIfNotPaired/g) ?? []).length).toBe(4);
  });

  it("approve, cancel and permission changes in queries/actions.ts carry the token too (ADR-082)", () => {
    const body = stripComments(
      (
        import.meta as unknown as {
          glob: (p: string, o: Record<string, unknown>) => Record<string, string>;
        }
      ).glob("../queries/actions.ts", { query: "?raw", import: "default", eager: true })[
        "../queries/actions.ts"
      ]!,
    );
    expect(body).toMatch(/api\.approveAction\(requireDeviceToken\(token\), id\)/);
    expect(body).toMatch(/api\.cancelAction\(requireDeviceToken\(token\), id\)/);
    expect(body).toMatch(
      /api\.updatePermission\(requireDeviceToken\(token\), permission, \{ granted \}\)/,
    );
  });
});
