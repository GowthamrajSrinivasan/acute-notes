/**
 * F38b against a real model: the follow-up-replies workflow on the AI tier.
 * (`e2e/local/followUpReplies.local.spec.ts` is the same workflow on the
 * local tier — the path a structured paste takes by default; here a template
 * is forced so the model builds the note and handles every follow-up.)
 *
 *   reply 1: a note — title, "Rollout Steps" checklist, "Risks", "Owners"
 *   reply 2: corrects the Risks sentence (how long the lock lasts) and adds a
 *            rollback-mitigation paragraph never discussed before
 *   reply 3: corrects only Owners
 *
 * One test, one step per check, so every step runs and reports even when the
 * model misjudges an earlier one. Hard assertions are the app's guarantees
 * (only the changed section is sent, with its current representation;
 * nothing is written before Accept; unchanged sections keep their exact
 * objects). Soft assertions are the model's judgement (one update, the new
 * detail as a linked child). Each review summary and each model reply is
 * attached to the report.
 *
 *   npm run test:e2e:ai -- --provider=gemini e2e/ai/followUpReplies.spec.ts --headed
 */
import { expect, test, type Request } from "@playwright/test";
import { elements, openApp, promptOf, recordAIRequests } from "../helpers";
import { connectAI } from "../aiProvider";
import { aiSession, allObjects, objectsMatching, relationsBetween, type Obj, caption } from "../aiReview";

const REPLY_1 = `# Database migration plan

## Rollout Steps

- [ ] Take a backup
- [ ] Run the migration
- [ ] Verify the users table

## Risks

The database migration may lock the users table during off-peak hours.

## Owners

The platform team owns the migration; the on-call DBA approves it.
`;
const REPLY_2 = REPLY_1.replace(
  "The database migration may lock the users table during off-peak hours.",
  "The database migration may lock the users table for about 90 seconds during off-peak hours.\n\n" +
    "Mitigation: if the lock lasts longer than two minutes, roll back with the prepared down-migration and retry in the next maintenance window.",
);
const REPLY_3 = REPLY_2.replace("the on-call DBA approves it.", "the on-call DBA and the security lead both approve it.");

const RISK = /lock the .?users.? table/i;
const MITIGATION = /roll ?back|down-migration/i;

test("follow-up replies pasted over one note: only what changed, detail as a linked child, paste after paste", async ({ browser }) => {
  test.setTimeout(900_000);
  const page = await browser.newPage();
  const requests: Request[] = recordAIRequests(page);
  const ai = aiSession(page, requests);
  await openApp(page);
  await connectAI(page);
  let risksId = "";

  await test.step("reply 1 becomes a note the model built: checklist, Risks and Owners — and nothing it didn't say", async () => {
    await caption(page, "reply 1 becomes a note the model built: checklist, Risks and Owners — and nothing it didn’t say", "Paste 1: a chat reply — title, Rollout Steps checklist, Risks, Owners — visualized by the AI");
    await ai.visualize(REPLY_1, "action_plan");
    const risks = await objectsMatching(page, RISK);
    expect(risks, "one object holds the Risks sentence").toHaveLength(1);
    risksId = risks[0]!.id;
    expect((await objectsMatching(page, /DBA/)).length, "an object for Owners").toBeGreaterThan(0);
    expect.soft(await objectsMatching(page, MITIGATION), "no rollback content invented before reply 2 mentions it").toEqual([]);
  });

  const untouched = (await objectsMatching(page, /backup|DBA/)).map((o) => o.id).sort();
  let summary2: string | null = null;
  let created: Obj[] = [];

  await test.step("Test 1 — reply 2 touches only what changed: the Risks section alone is re-analysed; one update, nothing rebuilt", async () => {
    await caption(page, "Test 1 — reply 2 touches only what changed: the Risks section alone is re-analysed; one update, nothing rebuilt", "Paste 2 corrects the Risks sentence (“about 90 seconds”) and adds a rollback mitigation");
    const before = await elements(page);
    summary2 = await ai.update(risksId, REPLY_2, "reply 2");
    // App guarantees: only the Risks section is sent (a second call is the runtime's one repair retry of the same request),
    // carrying what that section shows now; nothing written yet.
    expect(ai.generateCalls().length).toBeGreaterThan(0);
    for (const call of ai.generateCalls()) {
      const prompt = promptOf(call);
      expect(prompt).toContain("Current representation:");
      expect(prompt).toContain("90 seconds");
      expect(prompt).not.toContain("Take a backup");
      expect(prompt).not.toContain("on-call DBA");
    }
    expect(summary2, "a correction and new detail are changes").not.toBeNull();
    expect(summary2).not.toContain("needs your input");
    expect(await elements(page)).toEqual(before);
    // Model judgement: the corrected sentence is one update; nothing removed (moves are layout — F41 making room — not content).
    expect.soft(summary2, "one update (the Risks sentence)").toMatch(/~1 updated/);
    expect.soft(summary2, "no object removed").not.toMatch(/removed/);
  });

  await test.step("Test 2 — the mitigation is its own new block; Risks is updated in place, not duplicated or merged", async () => {
    await caption(page, "Test 2 — the mitigation is its own new block; Risks is updated in place, not duplicated or merged", "Accepting: Risks updates in place; the mitigation gets its own block");
    if (!summary2) return;
    const before = new Set((await allObjects(page)).map((o) => o.id));
    await ai.accept();
    created = (await allObjects(page)).filter((o) => !before.has(o.id));
    // Sections that weren't re-analysed keep their exact objects.
    expect((await objectsMatching(page, /backup|DBA/)).map((o) => o.id).sort()).toEqual(untouched);
    const risks = await objectsMatching(page, RISK);
    expect.soft(risks.map((o) => o.id), "the Risks sentence is still one object, the same one (updated in place)").toEqual([risksId]);
    expect.soft(risks[0]?.text ?? "", "Risks carries the correction").toContain("90 seconds");
    expect.soft(risks[0]?.text ?? "", "no merged wall of text").not.toMatch(MITIGATION);
    expect.soft(created.filter((o) => MITIGATION.test(o.text)), "exactly one new object holds the mitigation").toHaveLength(1);
  });

  await test.step("Test 3 — the mitigation block is attached to Risks, not floating", async () => {
    await caption(page, "Test 3 — the mitigation block is attached to Risks, not floating", "The mitigation is linked to Risks as its explanation");
    const mitigation = created.find((o) => MITIGATION.test(o.text));
    expect.soft(mitigation, "a new mitigation object").toBeDefined();
    if (!mitigation) return;
    const rel = await relationsBetween(page, risksId, mitigation.id);
    expect.soft(rel.length, "a visible connection between Risks and the mitigation").toBeGreaterThan(0);
    expect.soft(rel, "typed as an explanation of Risks").toContain("explained_by");
  });

  await test.step("Test 4 — reply 3 still proposes only its one change (Owners)", async () => {
    await caption(page, "Test 4 — reply 3 still proposes only its one change (Owners)", "Paste 3 corrects only Owners (adds the security lead)");
    const before = await elements(page);
    const kept = (await objectsMatching(page, /lock the|roll ?back|down-migration/i)).map((o) => o.id).sort();
    const summary = await ai.update(risksId, REPLY_3, "reply 3");
    expect(ai.generateCalls().length).toBeGreaterThan(0);
    for (const call of ai.generateCalls()) {
      const prompt = promptOf(call);
      expect(prompt).toContain("security lead");
      expect(prompt, "Risks is not re-analysed again").not.toContain("90 seconds");
    }
    expect(summary).not.toBeNull();
    expect(await elements(page)).toEqual(before); // still only a proposal
    expect.soft(summary, "one update (Owners)").toMatch(/~1 updated/);
    expect.soft(summary, "nothing new, removed or relinked").not.toMatch(/\+\d+ new|removed|links? changed/);
    await ai.accept();
    expect.soft((await objectsMatching(page, /security lead/i)).length, "Owners carries the correction").toBeGreaterThan(0);
    // Risks and the mitigation were not re-analysed: the same objects as before this paste.
    expect((await objectsMatching(page, /lock the|roll ?back|down-migration/i)).map((o) => o.id).sort()).toEqual(kept);
  });

  await page.context().close();
});
