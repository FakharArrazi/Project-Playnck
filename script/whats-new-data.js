

const CHANGELOG = [
  {
   version: "1.2.2",
    date: "September 13, 2026",
    highlights: [
      "Fixed: Auto-update failing with a \"check your network\" error even on a good connection — the app now shows the real reason an update failed instead of always blaming your internet.",
      "Fixed: The PLAYNCK wordmark above the song list rendering in the wrong font on some PCs.",
      "Fixed: The broken \"Add Language\" button in Language settings that silently switched your language — every supported language is now listed directly, no button needed.",
      "New: Linux now auto-updates like Windows does — no more manually downloading from the Releases page.",
      "New: Updates now ask before downloading, with a green dot on the Settings icon showing progress."
    ]
  }
];

export { CHANGELOG };
