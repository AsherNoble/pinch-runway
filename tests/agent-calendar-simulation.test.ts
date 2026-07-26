import assert from "node:assert/strict";
import test from "node:test";
import {
  applySeededCalendarEdits,
  getSeededCalendarEventIds,
  getSeededCalendarEvents,
  isSeededCalendarEventId,
  type SeededCalendarEdit,
} from "../lib/agent-integrations/google-seeded.ts";

// The calendar integration is deliberately simulated: edits are stored locally
// and replayed over an immutable fixture rather than written to Google. These
// tests pin the overlay semantics that make the calendar_edit permission
// observable — see lib/agent-integrations/google-seeded.ts.

const eventId = "calendar-frame-light-return";

function edit(overrides: Partial<SeededCalendarEdit>): SeededCalendarEdit {
  return {
    event_id: eventId,
    created_at: "2026-07-26T10:00:00.000Z",
    ...overrides,
  };
}

test("an unedited calendar read returns the fixture untouched", () => {
  const envelope = getSeededCalendarEvents();

  assert.equal(envelope.provenance, "simulated");
  assert.match(envelope.warning ?? "", /no event was read from Google/i);
  assert.equal(envelope.data.length, getSeededCalendarEventIds().length);
});

test("edits replay onto the fixture without mutating unedited fields", () => {
  const [updated] = applySeededCalendarEdits(
    getSeededCalendarEvents().data,
    [edit({ start_date_time: "2026-07-21T09:00:00+10:00" })],
  ).filter((event) => event.id === eventId);
  const original = getSeededCalendarEvents().data.find(
    (event) => event.id === eventId,
  );

  assert.equal(updated?.start.dateTime, "2026-07-21T09:00:00+10:00");
  assert.equal(updated?.summary, original?.summary);
  assert.equal(updated?.end.dateTime, original?.end.dateTime);
  // The fixture itself must stay pristine for the next read.
  assert.equal(original?.start.dateTime, "2026-07-20T09:00:00+10:00");
});

test("the last edit to a field wins regardless of input order", () => {
  const [updated] = applySeededCalendarEdits(
    getSeededCalendarEvents().data,
    [
      edit({ summary: "Second", created_at: "2026-07-26T12:00:00.000Z" }),
      edit({ summary: "First", created_at: "2026-07-26T11:00:00.000Z" }),
    ],
  ).filter((event) => event.id === eventId);

  assert.equal(updated?.summary, "Second");
});

test("notes append to the description rather than replacing it", () => {
  const original = getSeededCalendarEvents().data.find(
    (event) => event.id === eventId,
  );
  const [updated] = applySeededCalendarEdits(
    getSeededCalendarEvents().data,
    [edit({ note: "Pushed while cash is tight." })],
  ).filter((event) => event.id === eventId);

  assert.ok(updated?.description.startsWith(original?.description ?? ""));
  assert.match(updated?.description ?? "", /Runway note: Pushed while cash is tight\./);
});

test("a read carrying edits still declares itself simulated", () => {
  const envelope = getSeededCalendarEvents([edit({ summary: "Moved" })]);

  assert.equal(envelope.provenance, "simulated");
  assert.match(envelope.warning ?? "", /1 simulated Runway edit/);
  assert.match(envelope.warning ?? "", /no event was read from or written to Google/i);
});

test("only seeded event ids are recognised", () => {
  for (const id of getSeededCalendarEventIds()) {
    assert.equal(isSeededCalendarEventId(id), true);
  }
  assert.equal(isSeededCalendarEventId("calendar-invented-by-the-model"), false);
  assert.equal(isSeededCalendarEventId(undefined), false);
});
