import { describe, expect, it } from "vitest";
import { createFakeMailClient } from "./gmail-client.fake.js";
import { normalizeMailAccountId, resolveMailIdentity } from "./identity.js";

describe("normalizeMailAccountId", () => {
  it("lowercases and trims", () => {
    expect(normalizeMailAccountId("  Person@Example.COM  ")).toBe("person@example.com");
  });

  it("does NOT strip a +tag or dots from a Gmail local part", () => {
    // Over-normalizing an identity key is how two real accounts become one row
    // on the (provider, external_account_id) unique index. These are Gmail
    // delivery conveniences, not identity rules, and the provider reports one
    // canonical address anyway.
    expect(normalizeMailAccountId("a.b+work@gmail.com")).toBe("a.b+work@gmail.com");
    expect(normalizeMailAccountId("ab@gmail.com")).toBe("ab@gmail.com");
    expect(normalizeMailAccountId("a.b@gmail.com")).not.toBe(
      normalizeMailAccountId("ab@gmail.com"),
    );
  });
});

describe("resolveMailIdentity", () => {
  it("gets the address AND the bootstrap cursor from ONE call", async () => {
    const fake = createFakeMailClient();
    fake.queueProfile({ emailAddress: "Person@Example.com", historyId: "998877" });

    const identity = await resolveMailIdentity(fake, "tok");

    expect(identity.externalAccountId).toBe("person@example.com");
    expect(identity.bootstrapCursor).toBe("998877");
    // One request, not two: gmail.metadata authorises users.getProfile, so no
    // openid/email scope and no id_token are needed.
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.method).toBe("getProfile");
  });

  it("keeps the cursor an opaque string", async () => {
    const fake = createFakeMailClient();
    fake.queueProfile({ emailAddress: "a@b.com", historyId: "0000123" });
    const identity = await resolveMailIdentity(fake, "tok");
    // Not parsed to a number: leading zeros survive, because the value is the
    // provider's and its format is not ours to assume.
    expect(identity.bootstrapCursor).toBe("0000123");
  });

  it("throws rather than writing a row with an unknown identity", async () => {
    // external_account_id is NOT NULL precisely because a Postgres unique index
    // permits unlimited NULLs, so an unknown identity would bypass the
    // account-mismatch guard. Failing here means the row is never written.
    for (const bad of ["", "   "]) {
      const fake = createFakeMailClient();
      fake.queueProfile({ emailAddress: bad, historyId: "1" });
      await expect(resolveMailIdentity(fake, "tok")).rejects.toThrow(/no mailbox address/);
    }
  });

  it("throws when the provider returns no cursor", async () => {
    const fake = createFakeMailClient();
    fake.queueProfile({ emailAddress: "a@b.com", historyId: "  " });
    await expect(resolveMailIdentity(fake, "tok")).rejects.toThrow(/no cursor/);
  });

  it("propagates a provider error rather than inventing an identity", async () => {
    const fake = createFakeMailClient();
    // Nothing queued -> the fake throws, and resolveMailIdentity must not
    // swallow it into a default.
    await expect(resolveMailIdentity(fake, "tok")).rejects.toThrow(/unexpected call to getProfile/);
  });

  it("passes an AbortSignal through to the client", async () => {
    const fake = createFakeMailClient();
    fake.queueProfile({ emailAddress: "a@b.com", historyId: "1" });
    const controller = new AbortController();
    await resolveMailIdentity(fake, "tok", controller.signal);
    expect(fake.calls).toHaveLength(1);
  });
});
