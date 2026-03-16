// Logo and color metadata for multi-outcome market outcomes
// Keyed by outcome label (case-insensitive match)

interface OutcomeMeta {
  logo?: string;    // path in /public
  color?: string;   // tailwind color class
}

const META: Record<string, OutcomeMeta> = {
  "manchester united win": { logo: "/teams/manutd.svg", color: "text-red-600" },
  "manchester city win": { logo: "/teams/mancity.svg", color: "text-sky-500" },
  "draw": { logo: "/teams/draw.svg", color: "text-gray-500" },
};

export function getOutcomeMeta(label: string): OutcomeMeta {
  return META[label.toLowerCase()] || {};
}
