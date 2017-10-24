const WAVEBOX_CONTENT_IMPL_ENDPOINTS = {
  NOTIFICATION: 'Notification.js',
  CHROME: 'Chrome.js',
  CONTENT_WINDOW: 'ContentWindow.js',

  CREXTENSION_POPOUT_WINDOW_POSTMESSAGE: 'CRExtensionPopoutWindowPostmessage.js',

  GOOGLE_MAIL_WINDOW_OPEN: 'GoogleMailWindowOpen.js',
  GOOGLE_CALENDAR_ALERT: 'GoogleCalendarAlert.js',
  ONEDRIVE_WINDOW_OPEN: 'OnedriveWindowOpen.js'
}
const VALID_WAVEBOX_CONTENT_IMPL_ENDPOINTS = new Set(Array.from(Object.keys(WAVEBOX_CONTENT_IMPL_ENDPOINTS).map((k) => WAVEBOX_CONTENT_IMPL_ENDPOINTS[k])))

module.exports = {
  // Wavebox API Implementations
  WAVEBOX_CONTENT_IMPL_ENDPOINTS: WAVEBOX_CONTENT_IMPL_ENDPOINTS,
  VALID_WAVEBOX_CONTENT_IMPL_ENDPOINTS: VALID_WAVEBOX_CONTENT_IMPL_ENDPOINTS,

  // Extensions
  WAVEBOX_HOSTED_EXTENSION_PROTOCOL: 'waveboxhe',

  // Chrome
  CR_EXTENSION_PROTOCOL: 'chrome-extension',
  CR_EXTENSION_DOWNLOAD_PARTITION_PREFIX: '__download_chrome_extension:',
  CR_EXTENSION_BG_PARTITION_PREFIX: 'persist:__chrome_extension:',
  CR_RUNTIME_ENVIRONMENTS: {
    CONTENTSCRIPT: 'CONTENTSCRIPT',
    BACKGROUND: 'BACKGROUND',
    HOSTED: 'HOSTED'
  },
  CR_STORAGE_TYPES: {
    LOCAL: 'LOCAL',
    SYNC: 'SYNC'
  }
}
