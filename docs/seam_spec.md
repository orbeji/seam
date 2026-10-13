# Seam: Git Conflict Resolver Spec

Oct 12, 2026 · @Ender

A desktop Git client with a staging-area commit flow, diff viewer and three-pane conflict resolver; this spec fixes the scope, screens, git integration, merge algorithm and build order.

## Scope and MVP

The first version is three screens: a commit panel built on Git's staging area, a diff viewer, and a conflict resolver. Everything else the reference client bundles into its commit flow waits.

- **In the MVP:** staged and unstaged file lists; stage and unstage a file, a hunk or a single line; commit with message, amend and sign-off; side-by-side and unified diff; conflicts list; three-pane merge editor; abort and continue for merge, rebase, cherry-pick and stash pop.
- **Next:** push dialog (target branch, tags, force with lease), push-rejected flow (rebase or merge), blame annotations in the gutter, commit message history and templates.
- **Left out on purpose:** changelists (the reference client itself lets you swap them for the staging area, so the staging model is enough), commit checks such as reformat, inspections and TODO review, and upload-after-commit deployment. These depend on IDE features this app does not have.

## Reference behaviour

The features below describe the reference behaviour; the app should match them unless a later section says otherwise.

| Area | Reference behaviour | Page |
| --- | --- | --- |
| Conflicts dialog | Opens automatically when Git reports a conflict. Per file: Accept Yours, Accept Theirs, Resolve Manually. Resolve All Simple Conflicts merges easy files first. Accept and Finish is enabled once none remain. | Conflicts |
| Re-entering a merge | If the dialog is closed, or the merge started from the command line, a Merge Conflicts node appears in the changes list with a link. Toolbar has Resolve Conflicts and Abort Merge. | Conflicts |
| Merge editor layout | Three panes: left is the local copy (read-only), right is the repository version (read-only), centre is an editable result that starts as the base revision. | Conflicts |
| Change colours | Four kinds in the merge tool: modified, deleted, added, conflicting lines. In the diff viewer: green added, blue modified, gray deleted. | Conflicts, Diff |
| Per-change actions | Accept (arrow) or ignore (x) each side's change. Right-click a conflict for Resolve using Left or Resolve using Right. Hovering a gutter marker shows a toolbar with Revert. | Conflicts |
| Bulk apply | Apply All Non-Conflicting Changes, or only from the left or right side. A setting makes it automatic. | Conflicts, Diff |
| Simple conflicts | A separate button merges cases like the start and end of one line changed in different revisions. It is not part of bulk apply because the user should check the result. | Conflicts |
| Compare versions | A toolbar menu compares Base (common ancestor), Middle (current result) and the two sides. | Conflicts |
| Finishing a file | Apply Changes closes the file and opens the next one. Save and Close returns to the list. Revert conflict resolution restores the conflicted state. Undo and redo keep conflict markers in sync with the text. | Conflicts, Diff |
| Line endings | LF and CRLF differences show in the diff. An option warns before committing CRLF and offers Commit As Is or Fix and Commit (sets core.autocrlf). | Conflicts |
| Staging area | Enabled by a setting; the commit window then shows staged and unstaged changes. Stage a file from the list, a chunk from the gutter marker, or single lines in a three-way view (HEAD, Staged, Local) with an editable centre pane. Staged chunks get a hollow gutter marker, including ones staged outside the IDE. | Commit |
| Commit | Message with history, Amend, optional author and sign-off, Git hooks run unless switched off, Commit and Push in one action. | Commit |
| Push | Dialog lists outgoing commits per repository with a preview of each commit's files. Choose target remote and branch, optionally push tags (all, or current branch only). Force push uses force-with-lease and is blocked on protected branches. A rejected push offers Rebase or Merge. | Commit |
| Diff viewer | Side-by-side or unified. Ignore whitespace levels: none, trim, ignore, ignore plus empty lines, ignore imports and formatting. Highlight granularity: words, lines, split changes, characters, none. Collapse unchanged fragments, synchronized scrolling, aligned changes, next and previous difference, next and previous file, jump to source, blame annotations. | Diff |

## Screens and layout

One main window holds the file list and the diff; the conflict screens open on top of it when a merge, rebase, cherry-pick or stash pop stops.

| Screen | Contents | Opens from |
| --- | --- | --- |
| Main window | Left: change list grouped as Merge Conflicts (only during an operation), Staged, Unstaged, Untracked, with the commit message box under it. Right: diff viewer for the selected file. | App start, repository picker |
| Conflicts dialog | One row per conflicted file with Accept Yours, Accept Theirs and Resolve Manually; Resolve All Simple Conflicts; Accept and Finish. | Automatically when a git operation reports conflicts; the Resolve Conflicts link in the change list |
| Merge editor | Three panes (local, result, repository) with a toolbar; replaces the diff area or opens full-window. | Resolve Manually, or double-click a conflicted file |
| Staging diff | Three-way view (HEAD, Staged, Local) for line-level staging. | Context menu on a file in the change list |
| Push dialog (next) | Outgoing commits, target branch, tags, force option. | Push button |

Double-clicking a changed file opens its diff by default; a setting switches that to opening the file in an editor, as the reference client does.

## Screen designs

The four main screens are drawn on a design canvas: [Seam Screen Designs](https://claude.ai/artifact/1CXvBB7iXySC2PdpZnCR6x). They are static mockups of the behaviour in this spec, in a dark theme, with one sample repository and file set across all four.

- **Main window:** Staged, Unstaged and Untracked lists, the commit box, and a side-by-side diff with solid and hollow gutter markers and a hunk popup (Stage, Stage selected lines, Revert).
- **Conflicts dialog:** one row per file with its kind and status; Accept Yours, Accept Theirs and Resolve manually; Keep file or Delete file for a deletion; no manual option for a binary file; Abort merge; Accept and finish stays disabled until every file is resolved.
- **Merge editor:** Yours on the left, the editable result in the centre starting from the base, Theirs on the right; accept and ignore arrows per change; bulk apply buttons; Resolve simple conflicts; a right-click menu with Resolve using Left and Resolve using Right.
- **Line-level staging view:** HEAD, the editable index and the working copy side by side, with arrows to stage or unstage single lines.

## Commit panel and staging area

The app always works in staging-area mode: the index is the source of truth for what the next commit contains, so the panel shows exactly what `git status` would.

1. **Lists.** Staged, Unstaged and Untracked sections, each collapsible, each with a file count. A file with both staged and unstaged edits appears in both.
2. **Stage a file.** A plus button beside the file, plus a shortcut (the reference client uses Ctrl+Alt+A). Unstage is the same control on the staged row. Section headers stage or unstage everything in them.
3. **Stage a hunk.** In the diff, clicking the gutter marker beside a changed block shows Stage. Unstaged changes get a solid marker; changes already in the index get a hollow marker, including ones staged from the terminal.
4. **Stage single lines.** The three-way staging view shows HEAD on the left, Local on the right and the index in the editable centre. Edits in the centre are what gets staged. A shortcut inside any diff (select lines, Stage Selected Lines) covers the common case without opening this view.
5. **Commit.** Message box, an Amend toggle that loads the previous message, optional author override and sign-off, and a Run Git hooks toggle that is on by default. Commit creates a commit from the index only and is disabled while the index is empty; Amend stays enabled so the previous message can be reworded.
6. **Refresh.** The lists refresh on window focus and after every operation the app runs, so changes made in a terminal show up without a manual reload.

The commit message, the amend state and the selection survive switching files and restarting the app.

## Diff viewer

The viewer compares any two of HEAD, index and working copy, or two commits. The diff is computed inside the app, not by parsing `git diff` output, because word-level highlighting and the three-way views need the line mapping itself.

| Feature | Behaviour |
| --- | --- |
| Modes | Side-by-side (two panes) and unified (one pane). Only the working-copy side is editable: the right pane, or the lower line in unified mode. Read-only sides stay read-only. |
| Colours | Green added, blue modified, gray deleted. |
| Highlight granularity | Words, lines, split changes (large changes broken into smaller ones), characters, none. None exists for heavily rewritten files where highlighting hurts. |
| Ignore whitespace | None (default), trim leading and trailing, ignore all whitespace, ignore whitespace and empty lines. "Ignore imports and formatting" is language-aware and is not in the MVP. |
| Layout | Align changes with padding lines, synchronized scrolling, soft wrap, show whitespace as dots, line numbers, indent guides. |
| Collapse unchanged | Folds unchanged runs, keeping a configurable number of context lines; click a fold to expand it. |
| Navigation | Next and previous difference (F7, Shift+F7); at the last difference, one more press moves to the next changed file. Alt+Left and Alt+Right switch files. |
| Apply between panes | Chevron per change copies it to the other side; holding Ctrl turns it into append. Works in both modes. |
| Gutter menu | Annotate with git blame (later), stage this hunk, revert this hunk. |

Undo and redo (Ctrl+Z, Ctrl+Shift+Z) cover every edit and every applied change in the viewer.

## Conflict resolver

The resolver is two layers: a list of conflicted files, and a three-pane editor for one file.

**Conflicts list**

- Shows every file Git left unmerged, with its state (both modified, deleted by us, deleted by them, both added) and whether it is unresolved or resolved.
- Per file: Accept Yours (keep the checked-out branch's version), Accept Theirs (take the incoming version), Resolve Manually.
- Resolve All Simple Conflicts merges every file whose changes do not overlap and leaves the rest.
- Right-click a resolved file for Revert conflict resolution, which restores the conflict.
- Accept and Finish is enabled only when no unresolved file is left; it stages the results and continues the operation. Abort Merge is always available.

**Merge editor**

1. Left pane: your side, read-only. Right pane: the incoming side, read-only. Centre pane: the result, fully editable, starting from the common ancestor.
2. Each change in a side pane carries an accept arrow and an ignore x. Accepting copies the change into the result; ignoring marks it handled.
3. Right-clicking a conflict offers Resolve using Left and Resolve using Right.
4. The toolbar has Apply All Non-Conflicting Changes, and the same for the left or right side only; a setting can run it automatically on open.
5. A Resolve Simple Conflicts button handles cases like one side changing the start of a line and the other the end. It is kept apart from bulk apply so the user looks at the result.
6. A Compare menu compares Base (the common ancestor) and Middle (the current result) with the other versions.
7. Hovering a change marker in the result opens a small toolbar showing the previous text and a Revert action, so one wrongly applied change can be undone without losing the rest.
8. Apply Changes writes the file, marks it resolved and opens the next conflicted file. Save and Close returns to the list instead.

**Labelling.** The reference client says Yours and Theirs. During a rebase Git swaps the meaning of those two sides, so the app labels each pane with the branch or commit it comes from and maps Yours and Theirs to the right side per operation. This goes beyond the reference behaviour; it removes a common mistake.

## Git integration

This table describes behaviour, not commands, so it is a proposal: drive the real `git` executable as a child process rather than a library, so hooks, config, credential helpers and attributes behave exactly as in the terminal. Run every call with `LC_ALL=C` and `-c core.quotepath=false`, and parse machine formats with `-z`.

| Need | Command | Notes |
| --- | --- | --- |
| List changes and conflicts | `git status --porcelain=v2 -z --untracked-files=all` | Entries starting with `u` are unmerged; their two-letter code (UU, AA, DD, AU, UA, DU, UD) gives the conflict kind. |
| File versions for diff | `git show HEAD:<path>`, `git show :0:<path>`, working copy from disk | Missing side means the file does not exist there. |
| File versions for a conflict | `git show :1:<path>` base, `:2:` ours, `:3:` theirs | No `:1:` for add/add; a missing `:2:` or `:3:` means deleted on that side. |
| Stage or unstage a file | `git add -- <path>`; `git restore --staged -- <path>` | On a repository with no commits yet, unstage with `git rm --cached`. |
| Stage hunk or lines | Build the new index text, then `git hash-object -w --stdin` and `git update-index --cacheinfo <mode>,<sha>,<path>` | Writing the blob directly avoids patch fuzz. Read the mode from `git ls-files -s`. The staging diff's centre pane is that blob. |
| Write a resolution | Save the file, then `git add -- <path>` | Adding clears stages 1 to 3 and marks the file resolved. |
| Accept Yours or Theirs | `git checkout --ours -- <path>` or `--theirs`, then `git add` | For deleted-by-one-side files use `git rm` or `git add` to keep or drop the file. |
| Revert conflict resolution | `git checkout --merge -- <path>` | Git keeps resolve-undo data for this. Confirm in the first spike. |
| Detect the operation | Check `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `rebase-merge/`, `rebase-apply/` under `git rev-parse --git-dir` | A stash pop leaves conflicts and no marker file. |
| Finish or abort | `git commit --no-edit`, `git rebase --continue`, `git cherry-pick --continue`; `git merge --abort`, `git rebase --abort`, `git cherry-pick --abort` | Set `GIT_EDITOR=true` so Git never opens an editor. |
| Commit | `git commit -F - [--amend] [--author=...] [--signoff] [--no-verify]` | `--no-verify` only when Run Git hooks is off. |
| Push (next) | `git push [--force-with-lease] [--follow-tags \| --tags] <remote> <branch>` | Force is hidden for branches the user marks protected. |

Which side is Yours: in a merge, ours is the checked-out branch and theirs is the branch being merged. In a rebase it is reversed, because Git replays your commits onto the other branch. The app reads the operation state and labels the panes accordingly.

## Merge algorithm

The merge editor needs its own three-way engine, because it must expose every change as a region the user can accept, ignore or revert. Git's own result is only a cross-check.

1. **Inputs.** Base (stage 1), left (stage 2, yours) and right (stage 3, theirs), split into lines. Remember each line's original line ending so the output keeps it.
2. **Two diffs.** Diff base to left and base to right with a line diff (Myers, or patience for readability). Each result is a list of hunks: base range plus replacement lines.
3. **Group into regions.** Walk both hunk lists in base order and merge hunks that overlap or touch in the base into one region. Touching counts, to match Git's behaviour.
4. **Classify each region.**
   - Only left changed: non-conflicting, applies from the left.
   - Only right changed: non-conflicting, applies from the right.
   - Both changed to identical text: non-conflicting, applies either side.
   - Both changed differently: conflict.
5. **Build the result.** Start from base, as the reference client's centre pane does. Apply All Non-Conflicting Changes applies every region of the first three kinds; the left-only and right-only buttons apply just that side.
6. **Simple conflicts.** For each conflict, diff the region at word level (and character level for single lines) against base on both sides. If the inner changes do not overlap, the region is a simple conflict and the Resolve Simple Conflicts button merges it. Whitespace-only differences are also treated as simple. Bulk apply never touches these.
7. **Region state.** Every region stores its base, left, right and result ranges plus a state: unresolved, took left, took right, took both (order selectable), or edited by hand. Result ranges follow the text through typing and undo, so markers stay correct and Revert on a single region can restore its base or either side.
8. **Finish.** The file counts as resolved when no region is unresolved. Writing it back keeps the file's encoding, byte-order mark and dominant line ending.

Testing: for any inputs with no conflict regions, the engine's result must equal `git merge-file -p` on the same three files. Run that comparison as a property test over randomly generated edits, and keep a fixture set of real conflicts (add/add, delete/modify, moved blocks, whitespace-only edits).

## Architecture and stack

Recommendation: a TypeScript UI built on CodeMirror 6, with the merge and diff engine written in TypeScript so it runs next to the editor, and a thin backend that only runs Git and serves file versions. Ship it as an Electron desktop app for Windows and Linux, developed as a local web app first. Electron bundles one Chromium, so rendering is identical on both systems; Tauri would use WebView2 on Windows and WebKitGTK on Linux, which render differently. The editor is the hard part and has no equivalent in desktop-native toolkits. The backend is the Electron main process in Node, so there is one language and no JRE to ship.

| Option | UI and editor | Git layer | Trade-off |
| --- | --- | --- | --- |
| Local web app only | TypeScript, CodeMirror 6 (its merge package covers two-pane and unified diff; the three-pane view is custom) | Backend of your choice (for example Spring Boot or Symfony) running the `git` CLI | Good for development. Lacks native dialogs and file access, so it is a stepping stone, not the target. |
| Tauri 2 | Same web UI in a system web view | Rust backend running the `git` CLI | Small installer. Adds Rust to the project, and the web views differ between Windows and Linux. |
| Electron | Same web UI | Node backend running the `git` CLI | Recommended: identical rendering on Windows and Linux, one language end to end. Largest download. |
| Native JVM (JavaFX) | RichTextFX plus hand-built diff panes | `git` CLI via ProcessBuilder | One language end to end, but the three-pane editor, gutter markers and inline toolbars are all built from scratch. |

**Layers**

1. **UI.** Change list, diff viewer, merge editor, commit box. Holds merge region state, because it must follow the user's edits and undo history.
2. **API.** Typed IPC between the UI and the main process, including refresh events (HTTP and a socket during the local web app phase). Calls: status, file versions, stage and unstage (file or index text), commit, resolve, operation continue and abort.
3. **Core.** Git runner, status parser, operation-state detector. Index-changing commands go through one queue per repository, because Git locks the index and parallel writes fail.
4. **Watcher.** Watches the working tree and the git directory, debounced, and pushes a refresh event. A refresh on window focus is the fallback.

## Edge cases

| Case | Handling |
| --- | --- |
| Binary file | No merge editor. The conflicts list offers only Accept Yours and Accept Theirs. The diff shows that the file differs, with both sizes. A NUL byte in the first 8 KB marks a file as binary. |
| Deleted by one side (DU, UD) | The row says which side deleted it. Choices are keep the file or delete it; no three-pane editor. |
| Added by both (AA) | No common ancestor: the base is empty and the editor works as usual. |
| Renames | Status entries show old path to new path. Conflicts are keyed by the current path. |
| Line endings | Each side's ending (LF or CRLF) shows in the status bar and differences show in the diff. Before committing CRLF, warn and offer Commit As Is or Fix and Commit, which sets `core.autocrlf` to `true` on Windows and `input` on Linux and macOS. Skip the warning for files covered by Git attributes. |
| Encoding and BOM | Detect UTF-8 and UTF-16, keep the original on save, never rewrite a file's encoding silently. |
| Very large files | Past a size threshold (proposed: 5 MB or 50,000 lines) turn word-level highlighting off and fall back to line highlighting. |
| Symlinks, submodules, mode changes | Shown as non-text changes. Only whole-entry stage and unstage. |
| File changed on disk while open | Compare modification time on save; ask whether to reload or keep the editor's version. |
| Markers left in the result | On Apply Changes, warn if the text still contains `<<<<<<<`, `=======` or `>>>>>>>` lines. |
| Git hooks fail | Show the hook's output in the commit panel; the commit does not happen and the message is kept. |
| Windows and Linux differences | Use forward slashes for paths inside the app. Handle case-only renames on Windows, long paths (core.longpaths), and files locked by another process during save or checkout. Windows has no executable bit, so file modes come from the index, not the disk. |

## Milestones

The merge engine is the riskiest piece and the diff viewer shares its line diff, so both come before any git writes.

| Step | Delivers | Done when |
| --- | --- | --- |
| 0. Spike | Git runner, status parser, operation-state detector; check that `git checkout --merge` restores a resolved conflict | A script lists staged, unstaged, untracked and unmerged files on three sample repositories, on both Windows and Linux |
| 1. Diff viewer | Side-by-side and unified, highlighting levels, whitespace options, navigation | Matches the behaviours in the Diff viewer section on a fixture set |
| 2. Merge engine | Three-way regions, classification, simple conflicts, tracked result ranges | Property test against `git merge-file -p` passes; fixtures for add/add and delete/modify pass |
| 3. Staging | Stage and unstage by file, hunk and line; three-way staging view | A hunk staged in the app shows as staged in `git diff --cached`, and the reverse |
| 4. Commit | Message box, amend, sign-off, hooks toggle | Commits made in the app are identical to the same options on the command line |
| 5. Conflicts list | Conflicts dialog, Accept Yours or Theirs, Resolve All Simple Conflicts, operation detection | A merge, a rebase and a cherry-pick each stop and show correctly labelled sides |
| 6. Merge editor | Three panes, per-change actions, bulk apply, Compare menu, Revert, Apply Changes | A seeded conflict repository can be fully resolved without the terminal |
| 7. Finish and abort | Accept and Finish, continue and abort for every operation | Each operation completes or aborts and the repository state matches Git's |
| 8. Push | Push dialog, tags, force with lease, push-rejected flow | A rejected push offers rebase or merge and completes either |

## Decisions

Every question has an answer except the project name.

| Question | Decision | Effect on the spec |
| --- | --- | --- |
| Target platform | Desktop app for Windows and Linux; no macOS. I read your answer as desktop only, with no browser mode. | The stack section recommends Electron. Tests and CI run on both systems. |
| Commit with nothing staged | Blocked. | Commit is disabled while the index is empty, with a tooltip saying why. Amend stays enabled so the last message can be reworded. |
| Merge editor start | Base in the centre pane, as the reference client does. | Matches the merge algorithm section; no change. |
| Syntax highlighting | Autodetect the language; no fixed shortlist. | Detect from file name, extension and a first-line shebang. Load the matching CodeMirror language pack on demand. Fall back to plain text. |
| Changelists | Left out for good. | The staging area is the only model. No changelist code, settings or migration. |
| Licence | MIT. | Add a LICENSE file and MIT headers in the first commit. |
| Name | Seam. | Use it for the repository, package and window title. |

**Name: Seam.** It is where two pieces are joined, which fits a merge tool. Other candidates were Parley, Weft and Threeway. Availability is not checked against existing projects, trademarks or package names; check GitHub, npm and any registry you publish to before the first release.

## Notes

The git commands, merge algorithm, architecture, milestones and most edge cases are this spec's own proposals from general Git knowledge. They should be checked in the step 0 spike.
