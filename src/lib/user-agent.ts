/**
 * Human description of a browser user agent, e.g. "Edge en Windows".
 * Only for showing sessions to their owner; never for security decisions.
 */
export type DeviceInfo = {
  browser: string;
  os: string;
  mobile: boolean;
  label: string;
};

const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows NT/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

export function describeUserAgent(ua: string | null | undefined): DeviceInfo {
  const text = ua ?? "";
  const browser =
    BROWSERS.find(([pattern]) => pattern.test(text))?.[1] ?? "Navegador";
  const os = SYSTEMS.find(([pattern]) => pattern.test(text))?.[1] ?? "";
  const mobile =
    /Mobile|iPhone|Android(?!.*Tablet)/.test(text) && !/iPad/.test(text);
  const label = os ? `${browser} en ${os}` : browser;
  return { browser, os, mobile, label };
}
