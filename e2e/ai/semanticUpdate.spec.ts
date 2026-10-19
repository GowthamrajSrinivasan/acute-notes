/**
 * F38b against a real model — conceptual updates, the PRD's authentication
 * example (§13.15.19a). Watch it in headed mode:
 *
 *   npm run test:e2e:ai -- --provider=gemini e2e/ai/semanticUpdate.spec.ts --headed
 *   (ACUTE_SHOW_MS=4000 pauses on each review bar before it's accepted)
 *
 * One test, one step per scenario, so every step runs and reports even when
 * the model misjudges an earlier one. The app's guarantees are hard
 * assertions (nothing is written before Accept, a user-edited object is never
 * overwritten, the update carries the section's current representation). The
 * model's judgement — a rewording is unchanged, detail goes in a child — is
 * soft. Each review summary and each model reply is attached to the report.
 */
import { expect, test, type Request } from "@playwright/test";
import { elements, openApp, promptOf, recordAIRequests } from "../helpers";
import { connectAI } from "../aiProvider";
import { aiSession, allObjects, objectsMatching, relationsBetween, reviewBar, SHOW_MS, caption } from "../aiReview";

const V1 = "## Authentication\n\nUsers sign in with Firebase Auth. The backend validates the Firebase ID token. Then a session is created.\n";
const REWORDED = "## Authentication\n\nUsers sign in with Firebase Auth. The backend is responsible for validating the Firebase ID token. After that, a session is created.\n";
const ORG_CHECK = V1.replace("Then a session is created.", "The backend now also checks the user's organization membership before creating the session.");
const JWT = ORG_CHECK + "\nFirebase Authentication uses JWT-based ID tokens, which contain claims such as the user ID, email and custom claims, and expire after an hour.\n";

test("conceptual updates to an authentication flow: rewording, a new step, an explanation, a user edit", async ({ browser }) => {
  test.setTimeout(900_000);
  const page = await browser.newPage();
  const requests: Request[] = recordAIRequests(page);
  const ai = aiSession(page, requests);
  await openApp(page);
  await connectAI(page);
  let anchor = "";

  await test.step("first run: the authentication flow as a flowchart", async () => {
    await caption(page, "first run: the authentication flow as a flowchart", "Firebase Auth → Backend validates token → Session created");
    await ai.visualize(V1, "flow");
    const firebase = await objectsMatching(page, /Firebase/);
    expect(firebase.length).toBeGreaterThan(0);
    anchor = firebase[0]!.id;
  });

  await test.step("a rewording is not a change: nothing to review", async () => {
    await caption(page, "a rewording is not a change: nothing to review", "Same meaning, different words: “is responsible for validating”");
    const before = await elements(page);
    const summary = await ai.update(anchor, REWORDED, "rewording");
    // One section, sent with its current representation (a second call is the runtime's one repair retry).
    expect(ai.generateCalls().length).toBeGreaterThan(0);
    for (const call of ai.generateCalls()) expect(promptOf(call)).toContain("Current representation:");
    expect.soft(summary, "the model should report a rewording as unchanged").toBeNull();
    expect.soft(summary ?? "", "a rewording never removes a step").not.toMatch(/removed/);
    if (summary) await ai.reject();
    expect(await elements(page)).toEqual(before); // either way, nothing was written
  });

  await test.step("a changed concept (org-membership check): one new step, the flow rewired, no existing step rewritten", async () => {
    await caption(page, "a changed concept (org-membership check): one new step, the flow rewired, no existing step rewritten", "New: the backend also checks organization membership before the session");
    const summary = await ai.update(anchor, ORG_CHECK, "org check");
    expect(summary, "an added check is a conceptual change").not.toBeNull();
    expect(summary).not.toContain("needs your input"); // nothing was edited by hand yet
    expect.soft(summary).toMatch(/\+\d+ new/);
    expect.soft(summary, "existing steps keep their wording").not.toMatch(/~\d+ updated/);
    expect.soft(summary, "no step removed").not.toMatch(/removed/);
    await ai.accept();
    expect.soft((await objectsMatching(page, /organi[sz]ation/i)).length, "a step about the organization check").toBeGreaterThan(0);
  });

  await test.step("an expansion (JWT detail): a child explanation linked to its concept; the flow stays clean", async () => {
    await caption(page, "an expansion (JWT detail): a child explanation linked to its concept; the flow stays clean", "New detail: Firebase ID tokens are JWTs with claims");
    const before = new Set((await allObjects(page)).map((o) => o.id));
    const flowBefore = (await objectsMatching(page, /session/i)).map((o) => o.text);
    const summary = await ai.update(anchor, JWT, "JWT detail");
    expect(summary, "new detail is something to add").not.toBeNull();
    expect.soft(summary).toMatch(/\+\d+ new/);
    expect.soft(summary, "no existing step is rewritten to hold the detail").not.toMatch(/~\d+ updated/);
    await ai.accept();

    const created = (await allObjects(page)).filter((o) => !before.has(o.id));
    const detail = created.find((o) => /claims|JWT/i.test(o.text));
    expect.soft(detail, "a new explanation object about the tokens").toBeDefined();
    if (detail) {
      const concepts = (await allObjects(page)).filter((o) => before.has(o.id));
      const links = await Promise.all(concepts.map(async (c) => ({ c, rel: await relationsBetween(page, c.id, detail.id) })));
      const linked = links.filter((l) => l.rel.length);
      expect.soft(linked.length, "attached to an existing concept, not floating").toBeGreaterThan(0);
      expect.soft(linked.flatMap((l) => l.rel), "typed as an explanation").toContain("explained_by");
    }
    expect.soft((await objectsMatching(page, /session/i)).map((o) => o.text), "the flow's own steps are unchanged").toEqual(flowBefore);
  });

  await test.step("a concept the user edited is never overwritten: a conflict, and Keep mine keeps it", async () => {
    await caption(page, "a concept the user edited is never overwritten: a conflict, and Keep mine keeps it", "You edited a step by hand; the new content changes it too");
    const step = (await objectsMatching(page, /validat/i))[0];
    expect(step, "a validation step to edit").toBeDefined();
    await page.evaluate((id) => {
      type El = { id: string; type: string; containerId?: string | null; text?: string; originalText?: string; customData?: { acute?: { documentId?: string } } };
      type Dev = { api: { getSceneElements(): El[]; updateScene(s: unknown): void }; store: { get(id: string): { snapshot: unknown }; update(id: string, patch: unknown): void } };
      const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
      const els = dev.api.getSceneElements();
      const docId = els.find((e) => e.id === id)!.customData?.acute?.documentId;
      if (docId) dev.store.update(docId, { snapshot: JSON.parse(JSON.stringify(dev.store.get(docId).snapshot).replace(/token/i, "token (my note: also check expiry)")) });
      else dev.api.updateScene({ elements: els.map((e) => (e.type === "text" && e.containerId === id ? { ...e, text: `${e.text} (my note)`, originalText: `${e.originalText ?? e.text} (my note)` } : e)) });
    }, step!.id);
    const edited = (await objectsMatching(page, /my note/))[0]!;

    const summary = await ai.update(anchor, JWT.replace("validates the Firebase ID token", "validates the Firebase ID token and its App Check attestation"), "user edit");
    if (summary) {
      expect.soft(summary, "the edited step is flagged, not updated").toContain("needs your input");
      const card = reviewBar(page).getByRole("list", { name: "Changes that need your input" }).getByRole("listitem").first();
      if (await card.isVisible()) {
        await card.getByRole("button", { name: "Keep mine" }).click();
        if (SHOW_MS) await page.waitForTimeout(SHOW_MS);
      }
      const accept = reviewBar(page).getByRole("button", { name: /^Accept all/ });
      if (await accept.isEnabled()) await ai.accept();
      else await ai.reject();
    }
    // The app's guarantee, whatever the model proposed: the hand edit is still there.
    expect((await objectsMatching(page, /my note/)).map((o) => o.id)).toContain(edited.id);
  });

  await page.context().close();
});
