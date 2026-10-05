const CHANGELOG = [
  {
    version: "1.2.4",
    date: "October 5, 2026",
    highlights: [
      "New: Genres tab. Browse your library as a grid of colorful genre cards and open any genre to see its songs, total time and a play button. Songs with several genres appear under each one, untagged songs go under Unknown, and search now also matches genres and album artists.",
      "New: Redesigned Edit Track window with Basic, Album, Credits and Advanced sections and many more editable fields: genre, release year and date, original release date, album artist, track and disc numbers with totals, compilation, contributing artists, composer, lyricist, conductor, label, copyright, ISRC, BPM, grouping, subtitle, comment and lyrics. Invalid values are flagged before saving, and clicking outside no longer closes the window while you have unsaved changes. Existing songs are re-read once so the new fields fill in.",
      "New: Auto-Tag now also fetches extra details for the match you pick (genre, composer, lyricist, label, ISRC and release dates), and switching to another match undoes the previous match's changes to fields you haven't edited yourself.",
      "New: Keyboard Shortcuts section in Settings, plus a new R shortcut that adds an extra replay of the current song (a badge on the repeat button counts them) and Shift+R to clear them.",
      "New: Four animated now-playing backgrounds in Settings > Player: Organic, Flow, Nested and Waves. They follow your theme colors and hold still if your system requests reduced motion.",
      "New: Show Audio Information switch in Settings > Player to show or hide the sample rate, bitrate and format under the artist and album.",
      "New: Six more background themes (Burgundy Wine, Plum Violet, Espresso Brown, Deep Ocean Teal, Twilight Indigo and the light Cool Cloud) and six more accent colors (Sky, Fuchsia, Emerald, Slate, Copper and Olive).",
      "Improved: Album pages now open with a header showing the cover, album artist, year, song count, top genres, total length and a play button, followed by numbered tracks with disc labels. Artist pages show each album as its own panel with a play button and numbered tracks.",
      "Improved: Home tab. The Songs, Albums and Artists counts are now clickable shortcuts to those tabs, and Recently Played and Top Songs use the same panel style as albums, with Top Songs numbered and showing play counts.",
      "Improved: Saving an edit writes tags directly into MP3, FLAC and M4A files, leaves tags you didn't touch intact, and checks the file afterward. If a format can't store a field, such as WAV, Playnck tells you which ones were kept in your library only.",
      "Improved: File Info now also shows album artist, genre and release year when available.",
      "Fixed: Album, artist and genre pages now refresh after you edit a song instead of showing the old list.",
      "Fixed: Auto-Tag lookups no longer fail outright when MusicBrainz asks for a slowdown. Playnck now waits and retries.",
    ],
  },
];

export { CHANGELOG };
