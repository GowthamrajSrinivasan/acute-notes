# Agent Sync: a Claude Code hook recipe

Lens plan §8 (Phase 4). Acute-Notes never watches files: your IDE agent keeps the map current. This recipe makes Claude
Code do that without being asked each time. It is documentation, not shipped code: copy the pieces you want into the
repository you are mapping (not into Acute-Notes).

It needs the Acute-Notes MCP server connected to Claude Code, with a repo map already begun (`begin_repo_map`).

## How it works

1. **After each edit** (`PostToolUse` on `Edit|Write|MultiEdit`), a small script appends the edited file's path to
   `.claude/acute-changed-paths.txt`. It prints nothing, so Claude isn't interrupted.
2. **When Claude finishes its turn** (`Stop`), a second script checks that file. If it holds paths, it asks Claude to
   continue once more: follow the `keep_lens_current` prompt with those paths (`get_map_status` with `changedPaths`,
   re-send only the sections whose meaning changed, by the same keys). Then it empties the file.
3. Everything Claude sends is staged for review. Lens shows it as ghosts, and **● Agent Sync** shows in Lens's
   header. Nothing reaches the canvas until you accept it, unless you turned on auto-accept for the session.

The `Stop` step runs once per turn, so a batch of edits makes one sync, not one per keystroke. It checks
`stop_hook_active` so that it never asks twice in a row: the follow-up turn it starts ends normally.

## `.claude/settings.json` (in the mapped repository)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/acute-record-path.mjs\"" }]
      }
    ],
    "Stop": [
      {
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/acute-sync-on-stop.mjs\"" }]
      }
    ]
  }
}
```

Use `.claude/settings.local.json` instead to keep it to yourself (it is git-ignored).

## `.claude/hooks/acute-record-path.mjs`

```js
// PostToolUse: remember which file was edited (repo-relative), for the end of the turn.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

const input = JSON.parse(await new Promise((resolve) => {
  let data = "";
  process.stdin.on("data", (c) => (data += c)).on("end", () => resolve(data || "{}"));
}));
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const file = input.tool_input?.file_path;
if (file) {
  const path = relative(root, isAbsolute(file) ? file : join(root, file)).split("\\").join("/");
  if (path && !path.startsWith("..")) {
    const list = join(root, ".claude", "acute-changed-paths.txt");
    mkdirSync(dirname(list), { recursive: true });
    appendFileSync(list, path + "\n");
  }
}
```

## `.claude/hooks/acute-sync-on-stop.mjs`

```js
// Stop: if files changed this turn, ask Claude to keep the Acute map current, once.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const input = JSON.parse(await new Promise((resolve) => {
  let data = "";
  process.stdin.on("data", (c) => (data += c)).on("end", () => resolve(data || "{}"));
}));
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const list = join(root, ".claude", "acute-changed-paths.txt");
if (input.stop_hook_active || !existsSync(list)) process.exit(0);

const paths = [...new Set(readFileSync(list, "utf8").split("\n").map((l) => l.trim()).filter(Boolean))].slice(0, 200);
writeFileSync(list, "");
if (!paths.length) process.exit(0);

process.stdout.write(JSON.stringify({
  decision: "block",
  reason:
    "Acute Agent Sync: you changed " + paths.length + " file(s): " + JSON.stringify(paths) + ". " +
    "Follow the Acute-Notes keep_lens_current prompt: call get_map_status with these as changedPaths, " +
    "re-read the stale cards and decide for each affectedAncestors card whether its meaning changed, " +
    "then re-send only those sections with upsert_map_section (same keys). If none changed in meaning, say so and stop.",
}));
```

Add `.claude/acute-changed-paths.txt` to the repository's `.gitignore`.

## Variations

- **Lighter touch:** drop the `Stop` hook, and have the `PostToolUse` script print a reminder as
  `{"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "…"}}` instead. Claude sees it as
  context and decides when to sync. It doesn't force a follow-up turn, but it may sync less reliably.
- **Without hooks:** ask for it in plain words ("keep the Acute map current as you go"), or run the
  `keep_lens_current` prompt from Claude Code's prompt list after a batch of edits.

## Notes

- Check the hook fields against the current Claude Code hooks reference before relying on them
  (https://code.claude.com/docs/en/hooks). This recipe uses only `tool_input.file_path`, `cwd`, `stop_hook_active`,
  `CLAUDE_PROJECT_DIR`, and the `Stop` hook's `decision: "block"` / `reason`.
- The scripts read no file contents and send nothing anywhere. Only the paths reach Claude, which already edited
  those files.
- Pausing Agent Sync in Lens doesn't stop the agent. It only holds Lens's view still while you read.
