import { expect, test } from "bun:test";

import { safeReturnPath, withParam } from "./return-path";

test("this site's own pages come back as they are", () => {
  for (const path of [
    "/",
    "/vtc/new",
    "/vtc/nordic-haulage",
    "/vtc/nordic-haulage#join",
    "/leaderboards?period=all&game=ats",
    "/driver/cmhx0000000000000000000000",
    "/vtc/a%20b",
  ]) {
    expect(safeReturnPath(path)).toBe(path);
  }
});

test("another site is never accepted, however it is spelled", () => {
  for (const value of [
    "//evil.example",
    "//evil.example/vtc/new",
    "https://evil.example",
    "http://evil.example/",
    "/\\evil",
    "/\\evil.example",
    "/\\/evil.example",
    "\\\\evil.example",
    "\\/evil.example",
    // Browsers drop tabs and newlines inside a URL: these are "//evil.example".
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    // "." and ".." resolve away and leave "//evil.example".
    "/.//evil.example",
    "/..//evil.example",
    "/x/..//evil.example",
    "/./\\evil.example",
    // Not paths at all.
    "evil.example",
    "vtc/new",
    "javascript:alert(1)",
    "data:text/html,x",
    " /vtc/new",
    "https:evil.example",
    "///evil.example",
    "/\u0000",
    "",
  ]) {
    expect(safeReturnPath(value)).toBeNull();
  }
  expect(safeReturnPath(null)).toBeNull();
  expect(safeReturnPath(undefined)).toBeNull();
});

test("what is accepted stays on this site when a browser resolves it", () => {
  const site = "https://tacho.example";
  for (const value of [
    "/vtc/new",
    "/a/../b",
    "/a/./b?x=//evil.example",
    "/a#//evil.example",
    "/%2F%2Fevil.example",
    "/@evil.example",
    "/evil.example",
    "/a?next=https://evil.example",
  ]) {
    const path = safeReturnPath(value);
    expect(path).not.toBeNull();
    expect(new URL(path!, site).origin).toBe(site);
    // Also as the callback builds it: with a query parameter added.
    expect(new URL(withParam(path!, "steam", "linked"), site).origin).toBe(site);
  }
  // Dot segments are resolved before the path is handed back.
  expect(safeReturnPath("/a/../b")).toBe("/b");
});

test("API addresses are not pages to return to, and very long values are refused", () => {
  expect(safeReturnPath("/api/steam/connect")).toBeNull();
  expect(safeReturnPath("/api")).toBeNull();
  expect(safeReturnPath("/x/../api/auth/sign-out")).toBeNull();
  expect(safeReturnPath("/apiary")).toBe("/apiary");
  expect(safeReturnPath(`/${"a".repeat(600)}`)).toBeNull();
});

test("a result is added without losing the page's own query or fragment", () => {
  expect(withParam("/vtc/new", "steam", "linked")).toBe("/vtc/new?steam=linked");
  expect(withParam("/leaderboards?game=ats", "steam", "failed")).toBe(
    "/leaderboards?game=ats&steam=failed",
  );
  expect(withParam("/vtc/nordic-haulage#join", "steam", "linked")).toBe(
    "/vtc/nordic-haulage?steam=linked#join",
  );
  expect(withParam("/x?steam=old", "steam", "taken")).toBe("/x?steam=taken");
});
