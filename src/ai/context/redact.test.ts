import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact";

describe("redactSecrets", () => {
  it.each([
    ["sk-ant-api03-abcdefghijklmnopqrstuv", "sk-ant-"],
    ["sk-proj-abcdefghijklmnopqrstuv", "sk-proj-"],
    ["ghp_abcdefghijklmnopqrstuv", "ghp_"],
    ["github_pat_11ABCDEFG0123456789_abcdef", "github_pat_"],
    ["AIzaSyA-abcdefghijklmnopqrstuvwxyz0123", "AIza"],
    ["AKIAIOSFODNN7EXAMPLE", ""],
    ["xoxb-123456789012-abcdefghij", ""],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", ""],
    ["Authorization: Bearer abcdefghijklmnop0123456789", "Authorization: Bearer "],
    ['api_key = "abcd1234efgh5678"', 'api_key = "'],
    ["password: correcthorsebattery", "password: "],
  ])("redacts %s", (secret, kept) => {
    const out = redactSecrets(`before ${secret} after`);
    expect(out).toContain("[redacted]");
    expect(out.startsWith(`before ${kept}`)).toBe(true);
    expect(out.endsWith(" after") || out.endsWith('" after')).toBe(true);
  });

  it("redacts a PEM private key block", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    expect(redactSecrets(`key:\n${pem}\nend`)).not.toContain("MIIEpAIBAAKCAQEA");
  });

  it("leaves ordinary prose and code alone", () => {
    const text = "Use sk-learn for the model. The password policy needs 12 characters. const token = getToken();";
    expect(redactSecrets(text)).toBe(text);
  });
});
