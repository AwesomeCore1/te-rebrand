import { expect, test } from "bun:test";

import { countEvents, describeEvent, eventLine, eventsTotal, type JobEvent } from "./-events";

const fine = (offence: string, amount = 550): JobEvent => ({ type: "fine", offence, amount });
const ferry: JobEvent = { type: "ferry", source: "Dover", target: "Calais", amount: 320 };
const train: JobEvent = { type: "train", source: "Folkestone", target: "Calais", amount: 265 };
const toll: JobEvent = { type: "toll", amount: 38 };

test("each kind of event reads as one plain line with its price", () => {
  expect(eventLine(fine("speeding"), "ets2")).toBe("Fine: speeding, € 550");
  expect(eventLine(ferry, "ets2")).toBe("Ferry: Dover to Calais, € 320");
  expect(eventLine(train, "ets2")).toBe("Train: Folkestone to Calais, € 265");
  expect(eventLine(toll, "ats")).toBe("Toll, $ 38");
  expect(eventLine(fine("red_signal", 1250), "ats")).toBe("Fine: running a red light, $ 1 250");
});

test("the game's offence names are put in words", () => {
  expect(describeEvent(fine("avoid_sleeping"))).toBe("Fine: driving without rest");
  expect(describeEvent(fine("hard_shoulder_violation"))).toBe("Fine: driving on the hard shoulder");
  expect(describeEvent(fine("speeding_camera"))).toBe("Fine: speeding (camera)");
});

test("a fine without a stated reason is just a fine", () => {
  expect(describeEvent(fine("generic"))).toBe("Fine");
  expect(describeEvent(fine(""))).toBe("Fine");
});

test("an offence this page has no words for shows as the game named it", () => {
  expect(describeEvent(fine("overweight_axle"))).toBe("Fine: overweight axle");
});

test("a crossing with a missing name still reads as a sentence", () => {
  expect(describeEvent({ ...ferry, source: "" })).toBe("Ferry to Calais");
  expect(describeEvent({ ...ferry, target: " " })).toBe("Ferry from Dover");
  expect(describeEvent({ ...train, source: "", target: "" })).toBe("Train");
});

test("totals and counts", () => {
  const events = [toll, fine("speeding"), ferry, train, fine("no_lights", 150)];
  expect(eventsTotal(events)).toBe(38 + 550 + 320 + 265 + 150);
  expect(countEvents(events)).toBe("2 fines, 1 toll, 1 ferry and 1 train");
  expect(countEvents([toll, toll])).toBe("2 tolls");
  expect(countEvents([ferry, fine("speeding")])).toBe("1 fine and 1 ferry");
  expect(countEvents([])).toBe("");
  expect(eventsTotal([])).toBe(0);
});
