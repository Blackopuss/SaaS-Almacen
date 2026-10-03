/**
 * Short, readable IP for people: IPv6 is compressed ("::1"), IPv4-mapped
 * IPv6 becomes plain IPv4, and unknown/unspecified addresses return null.
 */
export function formatIp(ip: string | null | undefined): string | null {
  const value = ip?.trim();
  if (!value) return null;
  if (!value.includes(":")) return value;

  const mapped = /^(?:0{1,4}:){5}ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  if (mapped) return mapped[1]!;
  const mappedShort = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  if (mappedShort) return mappedShort[1]!;

  // Expand "::" so every group is present, then compress the longest zero run.
  const [head = "", tail] = value.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (tail === undefined && missing !== 0)) return value;
  const groups = [...left, ...Array(missing).fill("0"), ...right].map((g) =>
    g.replace(/^0+(?=.)/, "").toLowerCase(),
  );
  if (groups.every((g) => g === "0")) return null; // unspecified address

  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < groups.length;) {
    if (groups[i] !== "0") {
      i++;
      continue;
    }
    let j = i;
    while (j < groups.length && groups[j] === "0") j++;
    if (j - i > bestLength && j - i > 1) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  if (bestStart < 0) return groups.join(":");
  const before = groups.slice(0, bestStart).join(":");
  const after = groups.slice(bestStart + bestLength).join(":");
  return `${before}::${after}`;
}
