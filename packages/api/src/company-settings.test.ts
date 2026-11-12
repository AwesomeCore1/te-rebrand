import { expect, test } from "bun:test";

import { DEFAULT_COMPANY_SETTINGS, parseCompanySettings } from "./company-settings";

test("an empty settings column gives the defaults", () => {
  expect(parseCompanySettings({})).toEqual({
    about: "",
    recruitment: { open: false, questions: [] },
    discord: {
      deliveryChannelId: null,
      rankUpChannelId: null,
      eventChannelId: null,
      monthlyChannelId: null,
    },
  });
  expect(parseCompanySettings(null)).toEqual(DEFAULT_COMPANY_SETTINGS);
});

test("known fields are kept and missing ones filled in", () => {
  const settings = parseCompanySettings({
    recruitment: { open: true, questions: ["Why us?"] },
    discord: { deliveryChannelId: "123456789012345678" },
  });
  expect(settings.recruitment).toEqual({ open: true, questions: ["Why us?"] });
  expect(settings.discord.deliveryChannelId).toBe("123456789012345678");
  expect(settings.discord.rankUpChannelId).toBeNull();
});

test("settings that do not fit fall back to the defaults instead of throwing", () => {
  expect(parseCompanySettings({ recruitment: { open: "yes" } })).toEqual(DEFAULT_COMPANY_SETTINGS);
  expect(parseCompanySettings("nonsense")).toEqual(DEFAULT_COMPANY_SETTINGS);
});
