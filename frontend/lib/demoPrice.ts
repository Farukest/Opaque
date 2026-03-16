// Deterministic demo price from market address
// Each market gets a unique price between 1500-8500 BPS (15%-85%)
export function seededDemoPrice(address: string): number {
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    const char = address.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  // Map hash to range 1500-8500 (15% - 85%)
  const normalized = ((hash >>> 0) % 7001) + 1500;
  // Round to nearest 100 for clean display
  return Math.round(normalized / 100) * 100;
}
