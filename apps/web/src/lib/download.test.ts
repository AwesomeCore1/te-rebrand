import { expect, test } from "bun:test";

import { installerUrl } from "./download";

test("an https link is offered; nothing set means not released", () => {
  const release = "https://github.com/example/tacho/releases/latest/download/Tacho-setup.exe";
  expect(installerUrl(release)).toBe(release);
  expect(installerUrl(`  ${release}  `)).toBe(release);
  expect(installerUrl(undefined)).toBeNull();
  expect(installerUrl(null)).toBeNull();
  expect(installerUrl("")).toBeNull();
  expect(installerUrl("   ")).toBeNull();
});

test("anything a browser should not follow as a download is refused", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///C:/tacho.exe",
    "ftp://example.com/tacho.exe",
    "http://example.com/tacho.exe",
    "/downloads/tacho.exe",
    "not a url",
  ]) {
    expect(installerUrl(value)).toBeNull();
  }
  // Plain http only on this machine, for trying the page out.
  expect(installerUrl("http://localhost:3001/tacho.exe")).toBe("http://localhost:3001/tacho.exe");
});
