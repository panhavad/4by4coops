// Constants shared by the browser client and the Node server.

export const MAX_PLAYERS = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const NAME_MAX = 16;

export const STATE_RATE_HZ = 15;

export const DAY_LENGTH_MS = 18 * 60 * 1000;
export const MORNING_PHASE = 0.29;

export const METEORS_PER_REGION = 7;
export const METEORS_TO_OPEN_PORTAL = 5;
export const PORTAL_COUNTDOWN_MS = 8000;

export const UPGRADE_KINDS = ['engine', 'tires', 'suspension', 'winch', 'planks'];
export const UPGRADE_NAMES = {
  engine: 'Engine',
  tires: 'Off-road tires',
  suspension: 'Long-travel suspension',
  winch: 'Heavy winch',
  planks: 'Plank rack',
};
export const MAX_UPGRADE_LEVEL = 4;
export const BASE_PLANKS = 2;
export const plankCapacity = (level) => BASE_PLANKS + level;

// Paint palette (sRGB hex). Players pick an index.
export const VEHICLE_COLORS = [
  0xd9c39a, 0x4f7a45, 0x4a86b8, 0xe0743a, 0xc8473f, 0xe0b23a,
  0xf1f0ea, 0x3b3f45, 0x2f9c95, 0x8a62b5,
];

// Accessory bit flags.
export const ACCESSORIES = [
  { key: 'rack', name: 'Roof rack' },
  { key: 'lightbar', name: 'Light bar' },
  { key: 'snorkel', name: 'Snorkel (deeper water)' },
  { key: 'bullbar', name: 'Bull bar' },
  { key: 'spare', name: 'Spare wheel' },
];
export const hasAccessory = (mask, key) =>
  (mask & (1 << ACCESSORIES.findIndex((a) => a.key === key))) !== 0;

export const SPECIES = {
  deer: { name: 'Red deer', biome: 'valley' },
  rabbit: { name: 'Wild rabbit', biome: 'valley' },
  fox: { name: 'Red fox', biome: 'valley' },
  boar: { name: 'Wild boar', biome: 'valley' },
  moose: { name: 'Moose', biome: 'lakes' },
  bear: { name: 'Brown bear', biome: 'lakes' },
  beaver: { name: 'Beaver', biome: 'lakes' },
  wolf: { name: 'Grey wolf', biome: 'lakes' },
  coyote: { name: 'Coyote', biome: 'canyon' },
  bighorn: { name: 'Bighorn sheep', biome: 'canyon' },
  tortoise: { name: 'Desert tortoise', biome: 'canyon' },
  goat: { name: 'Mountain goat', biome: 'alpine' },
  marmot: { name: 'Marmot', biome: 'alpine' },
  arcticfox: { name: 'Arctic fox', biome: 'alpine' },
};
export const SPECIES_IDS = Object.keys(SPECIES);

export const EMOTES = ['👋', '👍', '😂', '😮', '🆘', '📸', '🏁', '❤️'];

export function dayPhase(now, shift) {
  const t = (now + shift) % DAY_LENGTH_MS;
  return (t < 0 ? t + DAY_LENGTH_MS : t) / DAY_LENGTH_MS;
}
