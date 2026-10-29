// Public settings for the Life OS pilot. Both values are safe to publish:
// the publishable (anon) key only allows what the row-level security rules allow.
// Fill these in from Supabase: Project Settings > API (or > API Keys).
window.LIFEOS_CONFIG = {
  supabaseUrl: 'https://kxlrmchwplwphsjlitiq.supabase.co',
  supabaseKey: 'sb_publishable_Fb2rW3MS_h3tSDs5gQJZ5g_ADXSBCrk',
  // Shows "Start this chat now" on the home screen, so you can test without waiting.
  // Add ?test=1 to the app link to turn it on for one phone.
  testing: false
};
