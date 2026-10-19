The checks now use the results dictionary for units and for wording, and both changes pass the full test suite. The demo script, diagram and deck are updated to match. Nothing is committed.

## 1. Units (Check 3a v3)

Before, a claim in a unit the checker had no rule for was rejected even when it was correct. That included degF, lbm/d, and even a claim in the file's own unit (degC). Now the checks look the unit up in the dictionary:

- **A unit the checker didn't know** is recognised from the dictionary's unit list. lbm/d with its conversion factor is now verified.
- **Temperature** is the one exception. °F and °C differ by an offset, so a factor can't convert them. A claim like "185 degF" from a degC curve is reported as "not checked: state it in degC" instead of being wrongly converted or rejected.
- **A curve whose unit contradicts its own label** (labelled pressure, but the file says m3/day) is reported as "not checked" instead of trusted.
- **A claim in the file's own unit** is never rejected for using an unknown unit.

## 2. Wording (Check 1-pre v3)

The checks now compare what an answer says with the labels on the curve it cites:

- **Surface vs reservoir:** calling `OILRATRC` "at surface conditions" sends the answer back. This is the SC/RC example the deck is built around, and before this change nothing caught it.
- **Wrong phase or quantity:** "oil rate" said about a water-rate curve is caught by its labels, not just by the words in the curve's name.
- **Named variables:** a full variable name or keyword in the text ("Bottom Hole Fluid Rate RC", "OILRATRC") is looked up in the dictionary and compared with the cited curve.

The word lists live in the engineer file, so engineers can change them without a code change. I added oil rate, gas rate, and surface/reservoir conditions words.

## How it stays safe

- **Same file, same version:** cmg-verify loads the same pinned dictionary file cmg-sr3 uses. It only uses it when its version matches the version stamped on the curves, so the checks never judge with different definitions from the ones the model saw.
- **Fallback:** if the versions differ or the dictionary is switched off, these checks behave as they did before. The surface/reservoir and phase checks keep working even then, because those labels travel on the curves.
- **Rollback:** both are new check versions and are the default. The engineer file can pin either check back to v2, and the b0 rollback profile still gives the old results.

## Tests

- **Full CI suite:** passes. That's 71/71 fixtures, 47/47 under the b0 rollback profile, the typecheck, the frozen-skills check and the engineer review document check.
- **No regressions:** all the existing fixtures already ran through the new code with no change in results.
- **Two new fixtures:**
  - **Units:** `check3a-v3-dictionary-units.yaml`, 7 claims.
  - **Wording:** `check1pre-v3-dictionary-wording.yaml`, 7 claims.
- **Proof they test the new code:** with the checks pinned back to v2, both fixtures fail exactly where expected.
- **Dictionary switched off:** both checks fall back cleanly.
- **Not done:** I haven't run a live session with a real model and cmg-sr3. The fixtures copy the server's real output format.

The main code changes are the new [results-dictionary.ts](.pi/extensions/cmg-verify/results-dictionary.ts) plus edits to [units.ts](.pi/extensions/cmg-verify/units.ts), [checks.ts](.pi/extensions/cmg-verify/checks.ts), [registries.ts](.pi/extensions/cmg-verify/registries.ts) and [engineer-judgements.yaml](.pi/skills/cmg-sr3-skill/registries/engineer-judgements.yaml). Regenerating the engineer review document also pulled in breakthrough wordings that were already in your uncommitted engineer file.

## Script, diagram and deck

- **Demo script:** no longer says curves carry units. It has three new scenarios (degF, a mislabelled curve, OILRATRC named in the text) and updated wording for Checks 1-pre and 3a and in the presenter notes.
- **Diagram:** now has the dictionary → checks engine arrow you asked for earlier, labelled "units · names (same version)". It's accurate now. The dictionary's info card is rewritten too.
- **Deck** ([link](https://claude.ai/artifact/8SAsof8zY8Y196SYtkTjUN)):
  - **New slide 8:** "What the checks look up in the dictionary".
  - **Corrected text:** the evidence, dictionary, knowledge and checklist slides. The dictionary slide's "open question" box became "Checked, not just labelled".
  - **Full-map slide:** a fresh picture of the updated diagram.
  - **Merge:** someone had added that full-map slide since my last update without renumbering, so I merged onto their version and renumbered all 26 footers.

## Left for you

- **Temporary folder:** delete `cmg-code/.deck-tmp`, which I used to stage the deck files. A safety check blocked me from removing it.
- **Old deck image:** the previous full-map image is still stored in the deck but no longer used. I left it in place.
