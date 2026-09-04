import Image from "next/image";

const AVATAR_SOURCES: Readonly<Record<string, string>> = {
  Tamish: "/avatars/tamish.svg",
  Priyanshu: "/avatars/priyanshu.svg",
  Akshat: "/avatars/akshat.svg",
  Anaya: "/avatars/anaya.svg",
  Khushi: "/avatars/khushi.svg",
  Yash: "/avatars/yash.svg",
};

const PALETTE: ReadonlyArray<readonly [string, string]> = [
  ["#dbe9e2", "#176247"], // green
  ["#e6e0f1", "#5b3f8c"], // violet
  ["#fbe2d2", "#9a5423"], // amber
  ["#d8e6f1", "#315f84"], // blue
  ["#f5dbe3", "#98456a"], // rose
  ["#e3ecd3", "#4f6b2a"], // olive
  ["#f9e6c9", "#8a6414"], // gold
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function tintOf(name: string): readonly [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  const source = AVATAR_SOURCES[name];
  if (source) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: "block", flex: "0 0 auto", overflow: "hidden",
          width: size, height: size, border: "1px solid rgba(29, 54, 43, .12)",
          borderRadius: "50%", background: "#edf3ef",
        }}
      >
        <Image src={source} alt="" width={size} height={size} unoptimized style={{ display: "block", width: "100%", height: "100%" }} />
      </span>
    );
  }

  const [bg, fg] = tintOf(name);
  return (
    <span
      aria-hidden="true"
      style={{
        display: "grid", placeItems: "center", flex: "0 0 auto",
        width: size, height: size, borderRadius: "50%",
        background: bg, color: fg,
        fontSize: Math.round(size * 0.38), fontWeight: 720, letterSpacing: "-.01em",
        fontVariantNumeric: "normal",
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
