/** Runtime feature switches for the current playable slice. */
const environment = import.meta.env ?? {};

export const FEATURES = Object.freeze({
  // Road mechanics stay hidden in normal builds. A developer can turn them
  // back on for focused regression playtests with VITE_GAMEPLAY_ROADS=true.
  roadsEnabled: environment.DEV === true && environment.VITE_GAMEPLAY_ROADS === 'true'
});
