// Public runtime config for the GitHub Pages build.
//
// Paste a Google Maps Platform browser key here (or enter one in the app's Settings,
// which keeps it only in that browser). The key WILL be visible to anyone who opens
// the site, so in Google Cloud Console restrict it to:
//   - Application restriction: Websites -> https://<your-user>.github.io/*
//   - API restriction: "Maps JavaScript API" and "Places API (New)"
// and set a daily quota cap. Leave it empty to run in demo mode.
window.CHOICES_CONFIG = {
  googleMapsApiKey: '',
};
