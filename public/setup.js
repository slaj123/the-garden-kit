// Your starting groups, places and contact rhythm. Written by `npm run setup` (or Claude Code's /setup).
// Changes made in the app ("Groups & places" at the bottom of the page) are saved on the server and win over this file.
// Scenes: groups use friends | family | professional | plain; places use coast | city | forest | plain.
globalThis.GARDEN_SETUP = {
  groups: [
    { name: "Friends", scene: "friends" },
    { name: "Family", scene: "family" },
    { name: "Professional", scene: "professional" },
  ],
  locations: [
    { name: "Coast", scene: "coast" },
    { name: "City", scene: "city" },
    { name: "Forest", scene: "forest" },
  ],
  // Days between conversations you're aiming for, by closeness level (1 = loose, 5 = closest).
  idealDays: { 1: 60, 2: 30, 3: 14, 4: 7, 5: 3 },
};
