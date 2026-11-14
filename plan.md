# sched-prod incident board — plan

The on-call board for sched-prod. One page, one list: tonight's incidents, newest first, so on-call sees
what just broke and takes it.

## Flows

| flow | who | what happens |
|------|-----|--------------|
| `open-board` | on-call | opens the board; sees tonight's incidents |
| `ack-incident` | on-call | picks an incident on the board and acks it — "I've got this one" |
| `watch-board` | on-call | keeps the board open; it stays current without a reload |

## Requirements

- **R1** New incidents appear live at the top of the list, newest first.
- **R2** Each incident row has an **Ack** button. Ack opens a confirm that names the incident id ("Ack INC-1234?"); only **confirm-ack** sends the ack (`api.ack(id)`) and marks the row acked. Cancel sends nothing. *(Changed 2026-11-14, product decision, see below.)*
- **R3** Show a loader until incidents load.
- **R4** The board refreshes itself every 2 seconds while open.
- **R5** Times show in the viewer's local time; day before month for EU locales (dd/mm).
- **R6** The page names its build: `<meta name="build" content="<git sha>">` in the head and the same sha in the footer.

## Hooks (pinned — tests and the replay rely on them)

| `data-testid` | element |
|---------------|---------|
| `board` | the board's main area |
| `loader` | the loader (gone once incidents load) |
| `empty` | what shows when there are no incidents |
| `incident-list` | the list |
| `incident-row` | one incident row, with `data-id="<incident id>"` |
| `ack` | the Ack button in a row |
| `acked` | the acked mark in a row |
| `build-sha` | the sha in the footer |
| `confirm` | the Ack confirm, naming the incident id |
| `confirm-ack` | the confirm's Ack button: sends the ack |
| `confirm-cancel` | the confirm's Cancel button: sends nothing |

## Decisions

- **2026-11-14, Ack asks to confirm (product).** Evidence: the step-1 recording, 00:24. While on-call aimed at INC-7352, a new incident landed at the top, every row moved down one slot, and the click acked INC-9435. Product kept R1 (live at the top) and the Ack on each row, and added a confirm that names the incident id, so a click that hits the wrong row shows up before anything is sent. Rejected: holding new incidents while the pointer is on the list (a new sev1 would wait), keeping rows still with scroll compensation, and keeping it as is.

## Done

Every issue in `issues/` delivered, deployed to a public https address, and shown working.
