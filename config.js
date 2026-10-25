// Public runtime config.
//
// Never commit a key here. The deploy workflow fills in googleMapsApiKey from the
// GOOGLE_MAPS_API_KEY repository secret when it publishes the site, so the key stays
// out of git. For local development, paste a key into the app's settings instead
// (it is kept only in that browser). Empty means demo mode.
//
// The key is still visible on the live site, so in Google Cloud Console restrict it to:
//   - Application restriction: Websites -> https://<your-user>.github.io/*
//   - API restriction: "Maps JavaScript API" and "Places API (New)"
window.CHOICES_CONFIG = {
  googleMapsApiKey: '',
};
