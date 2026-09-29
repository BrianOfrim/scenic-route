import assert from "node:assert/strict";
import { test } from "node:test";
import { planPosterActivityRebind, type RebindActivity, type RebindPoster } from "./posterActivityRebind";

const cabot: RebindActivity = { id: 2000000000001, name: "Cabot Trail", distance: 294_465 };
const cycle: RebindActivity = {
  id: 2000000000008,
  name: "Cycle: NSR Valley Cent North Bank Multiuse Pathway Cycle Route",
  distance: 15_351,
};
const berg: RebindActivity = { id: 2000000000000, name: "Berg Lake Trail", distance: 19_165 };

function poster(posterId: string, activityId: number, title: string, subtitle: string): RebindPoster {
  return { posterId, activityId, title, subtitle };
}

test("posters from a recycled id move to the activity with the same name", () => {
  let next = 5_000;
  const updates = planPosterActivityRebind(
    [
      poster("cycle", cabot.id, cycle.name, "15.0 km"),
      poster("cabot", cabot.id, "Cabot Trail", "Sep 24, 2026 · 294.5 km"),
    ],
    [cabot, cycle],
    () => next++,
  );
  assert.equal(updates.get("cycle"), cycle.id);
  assert.equal(updates.has("cabot"), false);
  assert.equal(next, 5_000);
});

test("unmatched posters on a recycled id leave together, including ones with no distance", () => {
  let next = 9_000;
  const updates = planPosterActivityRebind(
    [
      poster("d1", berg.id, "Danika playground tour cont.", "Sep 11, 2026 · 9.3 km · 36 min"),
      poster("d2", berg.id, "Danika playground tour cont.", ""),
      poster("berg", berg.id, "Berg Lake Trail", "Sep 24, 2026 · 19.2 km"),
      poster("n1", cabot.id, "North Sask, North Side", "15.0 km"),
      poster("n2", cabot.id, "North Sask, North Side", "15.0 km"),
    ],
    [cabot, berg, cycle],
    () => next++,
  );
  assert.equal(updates.has("berg"), false);
  assert.equal(updates.get("d1"), updates.get("d2"));
  assert.notEqual(updates.get("d1"), berg.id);
  assert.equal(updates.get("n1"), updates.get("n2"));
  assert.notEqual(updates.get("n1"), updates.get("d1"));
  assert.notEqual(updates.get("n1"), cabot.id);
  assert.notEqual(updates.get("n1"), cycle.id);
});

test("a custom title stays when the distance still matches", () => {
  const jog: RebindActivity = { id: 2000000000061, name: "Jog in around the valley", distance: 9_170 };
  const updates = planPosterActivityRebind(
    [poster("jog", jog.id, "Jog in & around the valley", "Sep 26, 2026 · 9.2 km")],
    [jog],
    () => 1,
  );
  assert.equal(updates.size, 0);
});

test("posters whose activity is gone keep their id", () => {
  const updates = planPosterActivityRebind(
    [poster("lunch", 19_994_452_422, "Lunch Ride", "Sep 1, 2026 · 13.7 km · 50 min")],
    [cabot],
    () => 1,
  );
  assert.equal(updates.size, 0);
});
