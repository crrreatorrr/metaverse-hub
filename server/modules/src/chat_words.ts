// Seed word lists for plaza chat (HubChat.filter). The owner extends them.
// Words are lowercase roots; matching folds case and leetspeak and also catches
// the plural/verb suffixes listed in HubChat. HARD words are stored ROT13 so the
// source is not a wall of slurs; a hard hit rejects the line (chat_rejected) and
// files an automatic report. MASK words are replaced with asterisks.
namespace HubChatWords {
  export var MASK: string[] = [
    "fuck", "fucker", "motherfucker", "shit", "bullshit", "bitch", "bastard", "asshole", "arsehole",
    "dick", "dickhead", "cock", "pussy", "wank", "wanker", "twat", "prick", "piss", "bollocks",
    "cunt", "slut", "whore", "retard", "douche", "jackass", "dipshit", "shithead", "fuckface",
  ];

  export var HARD_ROT13: string[] = [
    "avttre", "avttn", "snttbg", "snt", "xvxr", "fcvp", "puvax", "genaal", "jrgonpx", "pbba", "tbbx",
    "enturnq", "gbjryurnq",
  ];
}
