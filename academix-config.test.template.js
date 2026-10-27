/* Copy this file to academix-config.js ONLY in a separate test deployment.
   Replace both placeholders with values from a dedicated TEST Supabase project.
   Never use the production project URL here. Never place service-role or AI keys here. */
window.ACADEMIX_CONFIG = Object.freeze({
  environment: "TEST",
  supabaseUrl: "https://YOUR-TEST-PROJECT-REF.supabase.co",
  supabasePublishableKey: "YOUR_TEST_PROJECT_PUBLISHABLE_OR_ANON_KEY"
});
