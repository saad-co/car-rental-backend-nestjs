import { optOutKeyword } from "./opt-out.js";

describe("optOutKeyword", () => {
  it.each([
    "STOP",
    "stop",
    " Stop. ",
    "STOPALL",
    "Unsubscribe!",
    "cancel",
    "END",
    "quit",
  ])("reads %j as a stop request", (text) => {
    expect(optOutKeyword(text)).toBe("stop");
  });

  it.each(["START", "start", "Unstop."])(
    "reads %j as a start request",
    (text) => {
      expect(optOutKeyword(text)).toBe("start");
    },
  );

  it.each([
    "please stop by tomorrow",
    "I will pay today",
    "stop texting me",
    "",
    "123",
    "Can't stop",
  ])("leaves %j alone: an ordinary message", (text) => {
    expect(optOutKeyword(text)).toBeNull();
  });
});
