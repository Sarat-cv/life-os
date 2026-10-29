// Public settings for the Life OS pilot. Both values are safe to publish:
// the publishable (anon) key only allows what the row-level security rules allow.
// Fill these in from Supabase: Project Settings > API (or > API Keys).
window.LIFEOS_CONFIG = {
  supabaseUrl: 'https://kxlrmchwplwphsjlitiq.supabase.co',
  supabaseKey: 'sb_publishable_Fb2rW3MS_h3tSDs5gQJZ5g_ADXSBCrk',
  // Test mode, on for everyone during testing: every chat time on offer is 1 to 10 minutes away,
  // and "Start this chat now" appears on the home screen. Set to false for the real pilot.
  // (?test=1 on the link turns it on for one phone when this is false.)
  testing: true,
  // false (pilot): no email code, each phone gets a private account and the email is just saved.
  // true: people confirm their email with a 6-digit code (needs an email sender in Supabase).
  loginWithCode: false
};
